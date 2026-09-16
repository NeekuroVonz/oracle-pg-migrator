import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DataCopyRunsRepository,
  DataCopyTablesRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ProjectsRepository,
  toDataCopyRunDto,
} from "@migrator/db";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  AppError,
  ConflictError,
  DATA_COPY_CHUNK_SIZE_DEFAULT,
  type DataCopyJobData,
  type DataCopyRunDto,
  evaluateScopeCatalog,
  NotFoundError,
  type StartDataCopyInput,
  selectDataTables,
} from "@migrator/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class DataCopyService implements OnModuleDestroy {
  private readonly queue: ReturnType<typeof createQueue<DataCopyJobData>>;

  constructor(
    readonly env: AppEnv,
    private readonly projects: ProjectsRepository,
    private readonly connections: ConnectionsRepository,
    private readonly scopes: MigrationScopesRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly copyRuns: DataCopyRunsRepository,
    private readonly copyTables: DataCopyTablesRepository,
    private readonly audit: AuditRepository,
  ) {
    this.queue = createQueue<DataCopyJobData>(QUEUE_NAMES.dataCopy, env.REDIS_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async start(
    projectId: string,
    conversionRunId: string,
    input: StartDataCopyInput,
  ): Promise<DataCopyRunDto> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const source = await this.connections.getByProjectRole(projectId, "SOURCE");
    const target = await this.connections.getByProjectRole(projectId, "TARGET");
    if (source?.engine !== "ORACLE") {
      throw new AppError("SOURCE_REQUIRED", "Configure an Oracle source before copying data", 409);
    }
    if (target?.engine !== "POSTGRESQL") {
      throw new AppError(
        "TARGET_REQUIRED",
        "Configure a PostgreSQL target before copying data",
        409,
      );
    }
    const scope = await this.scopes.getByProjectId(projectId);
    if (!scope) {
      throw new AppError("SCOPE_REQUIRED", "Save a migration scope before copying data", 409);
    }
    if (scope.dataMode === "NONE") {
      throw new AppError("DATA_MODE_NONE", "Scope data mode is NONE; nothing to copy", 409);
    }
    const active = await this.copyRuns.findActiveByConversionRun(conversionRunId);
    if (active) {
      throw new ConflictError("A data copy is already in progress for this run");
    }
    const members = await this.runObjects.listObjects(conversionRunId);
    const decisions = evaluateScopeCatalog(
      members.map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
      })),
      {
        includeSchemas: scope.includeSchemas ?? [],
        includeObjectTypes: scope.includeObjectTypes ?? [],
        includeNamePatterns: scope.includeNamePatterns ?? [],
        excludeNamePatterns: scope.excludeNamePatterns ?? [],
        excludeObjects: scope.excludeObjects ?? [],
        dataMode: scope.dataMode,
        selectedTables: scope.selectedTables ?? [],
      },
    );
    const selected = new Set(
      selectDataTables(decisions, scope.dataMode, scope.selectedTables ?? []).map(
        (table) => table.id,
      ),
    );
    const tables = members.filter(
      (row) =>
        selected.has(row.id) &&
        row.objectType === "TABLE" &&
        row.status === "VALIDATED" &&
        !row.deferred,
    );
    if (tables.length === 0) {
      throw new AppError("NO_TABLES", "No VALIDATED tables are selected for data copy", 409);
    }
    const chunkSize =
      input.chunkSize ?? this.env.DATA_COPY_CHUNK_SIZE ?? DATA_COPY_CHUNK_SIZE_DEFAULT;
    const copyRun = await this.copyRuns.create({
      projectId,
      conversionRunId,
      status: "QUEUED",
      dataMode: scope.dataMode,
      chunkSize,
      tableCount: tables.length,
    });
    // Ensure pause flag is clear on a brand-new run (column default is false).
    await this.copyRuns.update(copyRun.id, { cancelRequested: false });
    const rows = await this.copyTables.replace(
      copyRun.id,
      tables.map((row) => ({
        objectId: row.id,
        owner: row.owner,
        name: row.name,
        targetSchema: row.targetSchema ?? row.owner.toLowerCase(),
        targetName: row.targetName ?? row.name.toLowerCase(),
        status: "PENDING" as const,
      })),
    );
    try {
      await this.queue.add(
        "data-copy",
        { projectId, conversionRunId, copyRunId: copyRun.id },
        { jobId: `data-copy-${copyRun.id}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
      );
    } catch (error) {
      await this.copyRuns.update(copyRun.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Failed to enqueue data copy",
        finishedAt: new Date(),
      });
      throw error;
    }
    await this.audit.append({
      projectId,
      action: "data-copy.started",
      entityType: "data_copy_run",
      entityId: copyRun.id,
      metadata: { conversionRunId, tableCount: tables.length, chunkSize, dataMode: scope.dataMode },
    });
    return toDataCopyRunDto(copyRun, rows);
  }

  /**
   * Re-queue the latest copy run for FAILED (+ leftover PENDING) tables only.
   * SUCCEEDED tables are left alone; mid-table failures keep lastOffset (no full truncate).
   */
  async resumeFailed(projectId: string, conversionRunId: string): Promise<DataCopyRunDto> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const active = await this.copyRuns.findActiveByConversionRun(conversionRunId);
    if (active) {
      throw new ConflictError("A data copy is already in progress for this run");
    }
    const copyRun = await this.copyRuns.getLatestForConversionRun(conversionRunId);
    if (!copyRun) {
      throw new AppError("NO_COPY_RUN", "Start a data copy before resuming failed tables", 409);
    }
    const retryable = await this.copyTables.resetRetryable(copyRun.id);
    if (retryable.length === 0) {
      throw new AppError("NO_FAILED_TABLES", "No failed or pending tables to resume", 409);
    }
    const updatedRun = await this.copyRuns.update(copyRun.id, {
      status: "QUEUED",
      failedCount: 0,
      errorMessage: null,
      cancelRequested: false,
      finishedAt: null,
      startedAt: null,
    });
    try {
      await this.queue.add(
        "data-copy",
        { projectId, conversionRunId, copyRunId: copyRun.id },
        {
          jobId: `data-copy-resume-${copyRun.id}-${Date.now()}`,
          attempts: 1,
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );
    } catch (error) {
      await this.copyRuns.update(copyRun.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Failed to enqueue data copy resume",
        finishedAt: new Date(),
      });
      throw error;
    }
    await this.audit.append({
      projectId,
      action: "data-copy.resume-failed",
      entityType: "data_copy_run",
      entityId: copyRun.id,
      metadata: {
        conversionRunId,
        retryTableCount: retryable.length,
        tables: retryable.map((row) => `${row.owner}.${row.name}`),
      },
    });
    const tables = await this.copyTables.listByCopyRun(copyRun.id);
    return toDataCopyRunDto(updatedRun, tables);
  }

  /** Cooperative pause: finish the current table, then stop. Resume failed afterwards. */
  async pause(projectId: string, conversionRunId: string): Promise<DataCopyRunDto> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const copyRun = await this.copyRuns.getLatestForConversionRun(conversionRunId);
    if (!copyRun) {
      throw new AppError("NO_COPY_RUN", "No data copy run to pause", 409);
    }
    if (copyRun.status !== "QUEUED" && copyRun.status !== "RUNNING") {
      throw new AppError("NOT_ACTIVE", "Data copy is not running", 409);
    }
    const updated = await this.copyRuns.update(copyRun.id, {
      cancelRequested: true,
      errorMessage: "Pause requested — finishing current table",
    });
    await this.audit.append({
      projectId,
      action: "data-copy.pause-requested",
      entityType: "data_copy_run",
      entityId: copyRun.id,
      metadata: { conversionRunId, previousStatus: copyRun.status },
    });
    const tables = await this.copyTables.listByCopyRun(copyRun.id);
    return toDataCopyRunDto(updated, tables);
  }

  async getLatest(projectId: string, conversionRunId: string): Promise<DataCopyRunDto | null> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const copyRun = await this.copyRuns.getLatestForConversionRun(conversionRunId);
    if (!copyRun) {
      return null;
    }
    const tables = await this.copyTables.listByCopyRun(copyRun.id);
    return toDataCopyRunDto(copyRun, tables);
  }
}
