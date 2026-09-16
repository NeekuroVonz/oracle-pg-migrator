import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
  formatDatabaseError,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ProjectsRepository,
  TestAttemptsRepository,
  toConversionAttemptDto,
  toConversionRunObjectDto,
  toDiscoveredObjectDto,
  toMigrationRunDto,
  toTestAttemptDto,
  toValidationAttemptDto,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  AppError,
  ConflictError,
  type ConversionJobData,
  type ListConversionRunObjectsQuery,
  MAPPING_RULES_VERSION,
  type MigrationStrategy,
  NotFoundError,
  parseRunTracks,
  type StartConversionInput,
  type ValidationJobData,
} from "@migrator/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class ConversionService implements OnModuleDestroy {
  private readonly queue: ReturnType<typeof createQueue<ConversionJobData>>;
  private readonly validationQueue: ReturnType<typeof createQueue<ValidationJobData>>;

  constructor(
    readonly env: AppEnv,
    private readonly projects: ProjectsRepository,
    private readonly scopes: MigrationScopesRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly attempts: ConversionAttemptsRepository,
    private readonly validations: ValidationAttemptsRepository,
    private readonly tests: TestAttemptsRepository,
    private readonly audit: AuditRepository,
    private readonly connections: ConnectionsRepository,
  ) {
    this.queue = createQueue<ConversionJobData>(QUEUE_NAMES.conversion, env.REDIS_URL);
    this.validationQueue = createQueue<ValidationJobData>(QUEUE_NAMES.validation, env.REDIS_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.validationQueue.close();
  }

  async start(projectId: string, input: StartConversionInput) {
    await this.projects.getByIdOrThrow(projectId);
    const catalog = await this.objects.listCatalog(projectId);
    if (catalog.length === 0) {
      throw new AppError(
        "DISCOVERY_REQUIRED",
        "Discover Oracle objects before starting a conversion run",
        409,
      );
    }
    const scope = await this.scopes.getByProjectId(projectId);
    if (!scope) {
      throw new AppError(
        "SCOPE_REQUIRED",
        "Save a migration scope before starting a conversion run",
        409,
      );
    }
    const active = await this.runs.findActiveByProject(projectId);
    if (active) {
      throw new ConflictError("A conversion run is already in progress for this project");
    }
    const target = await this.connections.getByProjectRole(projectId, "TARGET");
    if (target?.engine !== "POSTGRESQL") {
      throw new AppError(
        "TARGET_REQUIRED",
        "Configure a PostgreSQL target before starting a conversion run",
        409,
      );
    }
    const tracks = parseRunTracks({ tracks: input.tracks ?? ["SCHEMA"] });
    const strategy: MigrationStrategy = tracks.includes("PLSQL")
      ? (input.strategy ?? "FAST")
      : "FAST";
    const run = await this.runs.create({
      projectId,
      status: "QUEUED",
      strategy,
      mappingRulesVersion: MAPPING_RULES_VERSION,
      stats: { tracks },
    });
    try {
      await this.queue.add(
        "convert",
        { projectId, runId: run.id },
        { jobId: `conversion-${run.id}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
      );
    } catch (error) {
      await this.runs.update(run.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Failed to enqueue conversion",
        finishedAt: new Date(),
      });
      throw error;
    }
    await this.audit.append({
      projectId,
      action: "conversion.started",
      entityType: "migration_run",
      entityId: run.id,
      metadata: { strategy, tracks, mappingRulesVersion: MAPPING_RULES_VERSION },
    });
    return toMigrationRunDto(run);
  }

  async stop(projectId: string, runId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(runId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    if (run.status !== "QUEUED" && run.status !== "RUNNING") {
      throw new ConflictError("That run is not in progress");
    }
    await this.dropIdleJob(this.queue, `conversion-${run.id}`);
    await this.dropIdleJob(this.validationQueue, `validation-${run.id}`);
    const conversionIdle = await this.jobIsIdle(this.queue, `conversion-${run.id}`);
    const validationIdle = await this.jobIsIdle(this.validationQueue, `validation-${run.id}`);
    const finishNow = conversionIdle && validationIdle;
    try {
      const updated = await this.runs.update(run.id, {
        status: finishNow ? "CANCELLED" : run.status,
        errorMessage: "Stopped by user",
        stats: { ...(run.stats ?? {}), tracks: parseRunTracks(run.stats), cancelRequested: true },
        ...(finishNow ? { finishedAt: new Date() } : {}),
      });
      await this.audit.append({
        projectId,
        action: "conversion.stopped",
        entityType: "migration_run",
        entityId: run.id,
        metadata: { previousStatus: run.status, finishedNow: finishNow },
      });
      return toMigrationRunDto(updated);
    } catch (error) {
      const message = formatDatabaseError(error);
      if (/invalid input value for enum/i.test(message)) {
        throw new AppError(
          "MIGRATION_REQUIRED",
          "Metadata database is missing run status CANCELLED. Restart the API so it can apply migrations (or run bun run db:migrate), then stop the run again.",
          503,
        );
      }
      throw new AppError("STOP_FAILED", message, 500);
    }
  }

  private idleJobStates = new Set(["waiting", "delayed", "prioritized", "wait", "paused", "completed", "failed"]);

  private async dropIdleJob(
    queue: { getJob: (id: string) => Promise<{ getState: () => Promise<string>; remove: () => Promise<unknown> } | undefined> },
    jobId: string,
  ): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) {
      return;
    }
    const state = await job.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized" || state === "wait" || state === "paused") {
      await job.remove();
    }
  }

  private async jobIsIdle(
    queue: { getJob: (id: string) => Promise<{ getState: () => Promise<string> } | undefined> },
    jobId: string,
  ): Promise<boolean> {
    const job = await queue.getJob(jobId);
    if (!job) {
      return true;
    }
    const state = await job.getState();
    return this.idleJobStates.has(state);
  }

  async list(projectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const rows = await this.runs.listByProject(projectId);
    return rows.map(toMigrationRunDto);
  }

  async get(projectId: string, runId: string, query: ListConversionRunObjectsQuery) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(runId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const members = await this.runObjects.listObjects(runId);
    const filtered = members.filter((row) => {
      if (query.objectType && row.objectType !== query.objectType) {
        return false;
      }
      if (query.status && row.status !== query.status) {
        return false;
      }
      if (query.targetState && row.targetState !== query.targetState) {
        return false;
      }
      if (query.reconcileAction && row.reconcileAction !== query.reconcileAction) {
        return false;
      }
      return true;
    });
    const start = (query.page - 1) * query.pageSize;
    const objects = filtered.slice(start, start + query.pageSize).map(toConversionRunObjectDto);
    return {
      run: toMigrationRunDto(run),
      objects,
      page: query.page,
      pageSize: query.pageSize,
      total: filtered.length,
    };
  }

  async getObject(projectId: string, runId: string, objectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(runId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const member = await this.runObjects.getObject(runId, objectId);
    if (!member) {
      throw new NotFoundError("Object not in this run");
    }
    const object = await this.objects.getByIdOrThrow(objectId);
    const attempts = await this.attempts.listByRunObject(runId, objectId);
    const validations = await this.validations.listByRunObject(runId, objectId);
    const tests = await this.tests.listByRunObject(runId, objectId);
    return {
      ...toDiscoveredObjectDto(object),
      attempts: attempts.map(toConversionAttemptDto),
      validations: validations.map(toValidationAttemptDto),
      tests: tests.map(toTestAttemptDto),
    };
  }
}
