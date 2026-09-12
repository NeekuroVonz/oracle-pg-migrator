import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
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
  type StartConversionInput,
} from "@migrator/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class ConversionService implements OnModuleDestroy {
  private readonly queue: ReturnType<typeof createQueue<ConversionJobData>>;

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
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
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
    const strategy: MigrationStrategy = input.strategy ?? "FAST";
    const run = await this.runs.create({
      projectId,
      status: "QUEUED",
      strategy,
      mappingRulesVersion: MAPPING_RULES_VERSION,
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
      metadata: { strategy, mappingRulesVersion: MAPPING_RULES_VERSION },
    });
    return toMigrationRunDto(run);
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
