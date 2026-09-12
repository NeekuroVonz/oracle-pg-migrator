import {
  DataCopyRunsRepository,
  DataCopyTablesRepository,
  MigrationReportsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  ProjectsRepository,
  TestAttemptsRepository,
  toMigrationReportDto,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { buildObjectDag, orderByDag } from "@migrator/dependency-graph";
import {
  buildMigrationReport,
  countCompileOutcomes,
  dataCopyReadiness,
  formatValidatedSqlBundle,
  type MigrationReportDto,
  type MigrationReportSqlDto,
  NotFoundError,
  type ReportObjectInput,
} from "@migrator/shared";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ReportService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly validations: ValidationAttemptsRepository,
    private readonly tests: TestAttemptsRepository,
    private readonly reports: MigrationReportsRepository,
    private readonly copyRuns: DataCopyRunsRepository,
    private readonly copyTables: DataCopyTablesRepository,
  ) {}

  async get(projectId: string, runId: string): Promise<MigrationReportDto> {
    const run = await this.requireRun(projectId, runId);
    const snapshot = await this.reports.getByRunId(runId);
    if (snapshot && (run.status === "SUCCEEDED" || run.status === "FAILED")) {
      const copy = await this.copyRuns.getLatestForConversionRun(runId);
      if (!copy?.finishedAt || copy.finishedAt <= snapshot.updatedAt) {
        return toMigrationReportDto(snapshot);
      }
    }
    return this.build(projectId, runId, run.status === "SUCCEEDED" || run.status === "FAILED");
  }

  async getSql(projectId: string, runId: string): Promise<MigrationReportSqlDto> {
    await this.requireRun(projectId, runId);
    const { members, dag } = await this.loadMembersAndDag(projectId, runId);
    const validated = orderByDag(
      members.filter((row) => {
        if (row.status !== "VALIDATED" || row.deferred) {
          return false;
        }
        if (row.reconcileAction === "SKIP_UNCHANGED") {
          return false;
        }
        return Boolean(row.reconcileSql ?? row.targetSql);
      }),
      dag.order,
    );
    return {
      filename: `run-${runId.slice(0, 8)}-validated.sql`,
      objectCount: validated.length,
      sql: formatValidatedSqlBundle(
        validated.map((row) => ({
          owner: row.owner,
          name: row.name,
          objectType: row.objectType,
          sql: row.reconcileSql ?? row.targetSql ?? "",
        })),
      ),
    };
  }

  private async requireRun(projectId: string, runId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(runId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    return run;
  }

  private async loadMembersAndDag(projectId: string, runId: string) {
    const members = await this.runObjects.listObjects(runId);
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
    return { members, dag };
  }

  private async build(
    projectId: string,
    runId: string,
    persist: boolean,
  ): Promise<MigrationReportDto> {
    const run = await this.requireRun(projectId, runId);
    const { members, dag } = await this.loadMembersAndDag(projectId, runId);
    const validations = await this.validations.listByRun(runId);
    const tests = await this.tests.listByRun(runId);
    const compile = countCompileOutcomes(validations);
    const copy = await this.copyRuns.getLatestForConversionRun(runId);
    const copyTables = copy ? await this.copyTables.listByCopyRun(copy.id) : [];
    const data = copy ? dataCopyReadiness(copyTables) : { passed: 0, total: 0 };
    const stats = run.stats ?? {};
    const report = buildMigrationReport({
      projectId,
      runId,
      strategy: run.strategy as MigrationReportDto["strategy"],
      mappingRulesVersion: run.mappingRulesVersion,
      runStatus: run.status,
      objects: members.map(
        (row): ReportObjectInput => ({
          id: row.id,
          owner: row.owner,
          name: row.name,
          objectType: row.objectType,
          status: row.status as ReportObjectInput["status"],
          riskLevel: row.riskLevel as ReportObjectInput["riskLevel"],
          compileStatus: row.compileStatus as ReportObjectInput["compileStatus"],
          testStatus: row.testStatus as ReportObjectInput["testStatus"],
          compileError: row.compileError,
          testError: row.testError,
          deferred: row.deferred,
          attemptCount: row.attemptCount,
          reconcileAction: (row.reconcileAction as ReportObjectInput["reconcileAction"]) ?? null,
        }),
      ),
      graph: {
        nodeCount: dag.nodes.length,
        edgeCount: dag.edges.length,
        layerCount: dag.layers.length,
        cycleCount: dag.cycleCount,
        waitingCount: dag.waitingCount,
      },
      testsPassed: tests.filter((row) => row.status === "PASSED").length,
      testsFailed: tests.filter((row) => row.status === "FAILED").length,
      testsSkipped: tests.filter((row) => row.status === "SKIPPED").length,
      compileFirstAttempt: compile.firstAttempt,
      compileAfterRepair: compile.afterRepair,
      aiConvertCount: Number(stats.aiConvertCount ?? 0),
      aiFixCount: Number(stats.aiFixCount ?? 0),
      aiVerifyCount: Number(stats.aiVerifyCount ?? 0),
      dataPassed: data.total > 0 ? data.passed : undefined,
      dataTotal: data.total > 0 ? data.total : undefined,
    });
    if (persist) {
      await this.reports.upsert({
        projectId,
        runId,
        gateStatus: report.gateStatus,
        readinessPercent: report.readiness.overallPercent,
        payload: report,
      });
    }
    return report;
  }
}
