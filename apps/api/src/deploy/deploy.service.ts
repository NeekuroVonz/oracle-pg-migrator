import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DeployObjectsRepository,
  DeployRunsRepository,
  DiscoveredObjectsRepository,
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
import {
  deploySql,
  formatParentIssue,
  requiredTableRefs,
  selectDeployableWithParents,
  type DeployCandidate,
} from "./select-deployable";

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
    private readonly discovered: DiscoveredObjectsRepository,
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
    const memberCandidates: DeployCandidate[] = members.map((row) => ({
      id: row.id,
      owner: row.owner,
      name: row.name,
      objectType: row.objectType,
      status: row.status,
      deferred: row.deferred,
      reconcileAction: row.reconcileAction,
      targetState: row.targetState,
      targetSql: row.targetSql,
      reconcileSql: row.reconcileSql,
      targetSchema: row.targetSchema,
      targetName: row.targetName,
      metadata: row.metadata,
    }));
    const catalog = await this.discovered.listFingerprints(projectId);
    const catalogRelationsByOwnerName = new Map<string, DeployCandidate[]>();
    for (const row of catalog) {
      const type = String(row.objectType).toUpperCase();
      if (type !== "TABLE" && type !== "VIEW" && type !== "MATERIALIZED_VIEW") {
        continue;
      }
      const key = `${row.owner.toUpperCase()}.${row.name.toUpperCase()}`;
      const list = catalogRelationsByOwnerName.get(key) ?? [];
      list.push({
        id: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
        status: row.status,
        deferred: false,
        reconcileAction: row.reconcileAction,
        targetState: row.targetState,
        targetSql: row.targetSql,
        reconcileSql: row.reconcileSql,
        targetSchema: row.targetSchema,
        targetName: row.targetName,
        metadata: row.metadata,
      });
      catalogRelationsByOwnerName.set(key, list);
    }
    const {
      selected,
      skippedDependents,
      parentIssues,
    } = selectDeployableWithParents({
      members: memberCandidates,
      catalogRelationsByOwnerName,
    });
    const edges = await this.dependencies.listByProject(projectId);
    const edgeList = edges.map((edge) => ({
      fromId: edge.fromObjectId,
      toId: edge.toObjectId,
      dependencyType: edge.dependencyType,
    }));
    const relationByOwnerName = new Map<string, string>();
    for (const row of selected) {
      const type = String(row.objectType).toUpperCase();
      if (type === "TABLE" || type === "VIEW" || type === "MATERIALIZED_VIEW") {
        relationByOwnerName.set(`${row.owner.toUpperCase()}.${row.name.toUpperCase()}`, row.id);
      }
    }
    for (const row of selected) {
      for (const parent of requiredTableRefs(row)) {
        const parentId = relationByOwnerName.get(`${parent.owner}.${parent.name}`);
        if (!parentId || parentId === row.id) {
          continue;
        }
        edgeList.push({ fromId: row.id, toId: parentId, dependencyType: "PARENT_TABLE" });
      }
    }
    const dag = buildObjectDag({
      nodes: selected.map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
      })),
      selectedIds: selected.map((row) => row.id),
      unavailableIds: [],
      edges: edgeList,
    });
    const deployable = orderByDag(selected, dag.order);
    const skippedUnchanged = members.filter(
      (row) => row.status === "VALIDATED" && row.reconcileAction === "SKIP_UNCHANGED",
    ).length;
    if (deployable.length === 0 && skippedUnchanged === 0) {
      const hint =
        parentIssues.length > 0
          ? ` Parent issues: ${[...new Set(parentIssues.map(formatParentIssue))].slice(0, 8).join("; ")}`
          : "";
      throw new AppError(
        "NO_SQL",
        `No VALIDATED SQL is available to deploy.${hint}`,
        409,
      );
    }
    const snapshot = await this.reports.getByRunId(conversionRunId);
    const gateStatus = snapshot?.gateStatus ?? "IN_PROGRESS";
    const parentWarning =
      parentIssues.length > 0
        ? [...new Set(parentIssues.map(formatParentIssue))].slice(0, 12).join("; ")
        : null;
    const deployRun = await this.deployRuns.create({
      projectId,
      conversionRunId,
      status: "QUEUED",
      gateStatus,
      objectCount: deployable.length,
    });
    if (parentWarning) {
      await this.deployRuns.update(deployRun.id, {
        errorMessage: `Deploy continues; skipped ${skippedDependents.length} dependent object(s) whose parents are in scope but not VALIDATED yet. ${parentWarning}`,
      });
    }
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
        sql: deploySql(row) ?? "",
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
        skippedDependents,
        parentIssues: parentIssues.slice(0, 30),
      },
    });
    const latest = parentWarning
      ? ((await this.deployRuns.getById(deployRun.id)) ?? deployRun)
      : deployRun;
    return toDeployRunDto(latest, rows);
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
