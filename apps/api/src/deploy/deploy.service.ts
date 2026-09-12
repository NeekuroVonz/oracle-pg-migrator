import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DeployObjectsRepository,
  DeployRunsRepository,
  MigrationReportsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  ProjectsRepository,
  toDeployRunDto,
} from "@migrator/db";
import { buildObjectDag, orderByDag } from "@migrator/dependency-graph";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  AppError,
  ConflictError,
  type DeployJobData,
  type DeployRunDto,
  NotFoundError,
  type StartDeployInput,
} from "@migrator/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class DeployService implements OnModuleDestroy {
  private readonly queue: ReturnType<typeof createQueue<DeployJobData>>;

  constructor(
    readonly env: AppEnv,
    private readonly projects: ProjectsRepository,
    private readonly connections: ConnectionsRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly reports: MigrationReportsRepository,
    private readonly deployRuns: DeployRunsRepository,
    private readonly deployObjects: DeployObjectsRepository,
    private readonly audit: AuditRepository,
  ) {
    this.queue = createQueue<DeployJobData>(QUEUE_NAMES.deploy, env.REDIS_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async start(
    projectId: string,
    conversionRunId: string,
    _input: StartDeployInput,
  ): Promise<DeployRunDto> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    if (run.status === "QUEUED" || run.status === "RUNNING") {
      throw new ConflictError("Finish conversion before deploying SQL");
    }
    const target = await this.connections.getByProjectRole(projectId, "TARGET");
    if (target?.engine !== "POSTGRESQL") {
      throw new AppError(
        "TARGET_REQUIRED",
        "Configure a PostgreSQL target before deploying SQL",
        409,
      );
    }
    const active = await this.deployRuns.findActiveByConversionRun(conversionRunId);
    if (active) {
      throw new ConflictError("A deploy is already in progress for this run");
    }
    const members = await this.runObjects.listObjects(conversionRunId);
    const edges = await this.dependencies.listByProject(projectId);
    const dag = buildObjectDag({
      nodes: members.map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
      })),
      selectedIds: members.map((row) => row.id),
      unavailableIds: members.filter((row) => row.deferred).map((row) => row.id),
      edges: edges.map((edge) => ({
        fromId: edge.fromObjectId,
        toId: edge.toObjectId,
        dependencyType: edge.dependencyType,
      })),
    });
    const deployable = orderByDag(
      members.filter((row) => {
        if (row.status !== "VALIDATED" || row.deferred) {
          return false;
        }
        if (row.reconcileAction === "SKIP_UNCHANGED") {
          return false;
        }
        if (
          row.reconcileAction === "REVIEW_REQUIRED" ||
          row.targetState === "TARGET_DRIFTED" ||
          row.targetState === "TARGET_CONFLICT"
        ) {
          return false;
        }
        const sql = row.reconcileSql ?? row.targetSql;
        return Boolean(sql);
      }),
      dag.order,
    );
    const skippedUnchanged = members.filter(
      (row) => row.status === "VALIDATED" && row.reconcileAction === "SKIP_UNCHANGED",
    ).length;
    if (deployable.length === 0 && skippedUnchanged === 0) {
      throw new AppError("NO_SQL", "No VALIDATED SQL is available to deploy", 409);
    }
    const snapshot = await this.reports.getByRunId(conversionRunId);
    const gateStatus = snapshot?.gateStatus ?? "IN_PROGRESS";
    const deployRun = await this.deployRuns.create({
      projectId,
      conversionRunId,
      status: "QUEUED",
      gateStatus,
      objectCount: deployable.length,
    });
    const rows = await this.deployObjects.replace(
      deployRun.id,
      deployable.map((row, index) => ({
        objectId: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
        targetSchema: row.targetSchema,
        targetName: row.targetName,
        sortIndex: index,
        sql: row.reconcileSql ?? row.targetSql ?? "",
        status: "PENDING" as const,
      })),
    );
    try {
      await this.queue.add(
        "deploy",
        { projectId, conversionRunId, deployRunId: deployRun.id },
        { jobId: `deploy-${deployRun.id}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
      );
    } catch (error) {
      await this.deployRuns.update(deployRun.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Failed to enqueue deploy",
        finishedAt: new Date(),
      });
      throw error;
    }
    await this.audit.append({
      projectId,
      action: "deploy.started",
      entityType: "deploy_run",
      entityId: deployRun.id,
      metadata: {
        conversionRunId,
        objectCount: deployable.length,
        gateStatus,
      },
    });
    return toDeployRunDto(deployRun, rows);
  }

  async getLatest(projectId: string, conversionRunId: string): Promise<DeployRunDto | null> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(conversionRunId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const deployRun = await this.deployRuns.getLatestForConversionRun(conversionRunId);
    if (!deployRun) {
      return null;
    }
    const objects = await this.deployObjects.listByDeployRun(deployRun.id);
    return toDeployRunDto(deployRun, objects);
  }
}
