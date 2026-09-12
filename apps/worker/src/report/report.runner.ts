import {
  AuditRepository,
  type DiscoveredObjectRow,
  MigrationReportsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  TestAttemptsRepository,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { buildObjectDag } from "@migrator/dependency-graph";
import {
  buildMigrationReport,
  countCompileOutcomes,
  type MigrationReportDto,
  type ReportObjectInput,
} from "@migrator/shared";

function toReportObject(row: DiscoveredObjectRow & { deferred: boolean }): ReportObjectInput {
  return {
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
  };
}

export async function runReport(input: {
  projectId: string;
  runId: string;
  runs: MigrationRunsRepository;
  runObjects: MigrationRunObjectsRepository;
  dependencies: ObjectDependenciesRepository;
  validations: ValidationAttemptsRepository;
  tests: TestAttemptsRepository;
  reports: MigrationReportsRepository;
  audit: AuditRepository;
  dataPassed?: number;
  dataTotal?: number;
}): Promise<MigrationReportDto> {
  const run = await input.runs.getById(input.runId);
  if (!run || run.projectId !== input.projectId) {
    throw new Error("Migration run not found");
  }
  const members = await input.runObjects.listObjects(input.runId);
  const edges = await input.dependencies.listByProject(input.projectId);
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
  const validations = await input.validations.listByRun(input.runId);
  const tests = await input.tests.listByRun(input.runId);
  const compile = countCompileOutcomes(validations);
  const stats = run.stats ?? {};
  const report = buildMigrationReport({
    projectId: input.projectId,
    runId: input.runId,
    strategy: run.strategy as MigrationReportDto["strategy"],
    mappingRulesVersion: run.mappingRulesVersion,
    runStatus: run.status,
    objects: members.map(toReportObject),
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
    dataPassed: input.dataPassed,
    dataTotal: input.dataTotal,
  });
  await input.reports.upsert({
    projectId: input.projectId,
    runId: input.runId,
    gateStatus: report.gateStatus,
    readinessPercent: report.readiness.overallPercent,
    payload: report,
  });
  await input.audit.append({
    projectId: input.projectId,
    action: "report.completed",
    entityType: "migration_run",
    entityId: input.runId,
    metadata: {
      gateStatus: report.gateStatus,
      readinessPercent: report.readiness.overallPercent,
      blockingCount: report.blockingCount,
    },
  });
  return report;
}
