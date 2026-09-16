import {
  AI_PROMPT_VERSION,
  type CompileStatus,
  MAPPING_RULES_VERSION,
  type MigrationRunStatus,
  type MigrationStrategy,
  type ObjectStatus,
  type OracleObjectType,
  REPORT_BLOCKING_STATUSES,
  type ReconcileAction,
  type ReportGateStatus,
  type RiskLevel,
  type TestAttemptStatus,
} from "./enums";
import type { MigrationReportDto } from "./schemas";

export const READINESS_WEIGHTS = {
  schema: 0.15,
  data: 0.15,
  compile: 0.2,
  behavior: 0.2,
  performance: 0.1,
  constraints: 0.15,
  sequences: 0.05,
} as const;

export type ReadinessDimension = keyof typeof READINESS_WEIGHTS;

export interface ReadinessBreakdown {
  schemaPercent: number | null;
  dataPercent: number | null;
  compilePercent: number | null;
  behaviorPercent: number | null;
  performancePercent: number | null;
  constraintsPercent: number | null;
  sequencesPercent: number | null;
  overallPercent: number;
  reviewRequired: number;
  redesignRequired: number;
  blockingIssues: number;
  notes: string[];
}

export interface ReportObjectInput {
  id: string;
  owner: string;
  name: string;
  objectType: OracleObjectType | string;
  status: ObjectStatus;
  riskLevel: RiskLevel | null;
  compileStatus: CompileStatus | null;
  testStatus: TestAttemptStatus | null;
  compileError: string | null;
  testError: string | null;
  deferred: boolean;
  attemptCount: number;
  reconcileAction: ReconcileAction | null;
  targetSql?: string | null;
  tableName?: string | null;
}

export interface ReportGraphInput {
  nodeCount: number;
  edgeCount: number;
  layerCount: number;
  cycleCount: number;
  waitingCount: number;
}

export interface BuildMigrationReportInput {
  projectId: string;
  runId: string;
  strategy: MigrationStrategy;
  mappingRulesVersion: string;
  runStatus: MigrationRunStatus;
  objects: ReportObjectInput[];
  graph: ReportGraphInput;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  compileFirstAttempt: number;
  compileAfterRepair: number;
  aiConvertCount: number;
  aiFixCount: number;
  aiVerifyCount: number;
  dataPassed?: number;
  dataTotal?: number;
  generatedAt?: string;
}

export function dataCopyReadiness(
  tables: Array<{
    status: string;
    oracleRows: number | null;
    postgresRows: number | null;
  }>,
): { passed: number; total: number } {
  const sampled = tables.filter((table) => table.oracleRows != null && table.postgresRows != null);
  return {
    total: sampled.length,
    passed: sampled.filter((table) => table.oracleRows === table.postgresRows).length,
  };
}

export function isReportBlockingStatus(status: ObjectStatus): boolean {
  return (REPORT_BLOCKING_STATUSES as readonly string[]).includes(status);
}

export function countCompileOutcomes(
  attempts: Array<{ objectId: string; attemptNumber: number; status: string }>,
): { firstAttempt: number; afterRepair: number } {
  const earliestPass = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.status !== "PASSED") {
      continue;
    }
    const current = earliestPass.get(attempt.objectId);
    if (current === undefined || attempt.attemptNumber < current) {
      earliestPass.set(attempt.objectId, attempt.attemptNumber);
    }
  }
  let firstAttempt = 0;
  let afterRepair = 0;
  for (const attemptNumber of earliestPass.values()) {
    if (attemptNumber <= 1) {
      firstAttempt += 1;
    } else {
      afterRepair += 1;
    }
  }
  return { firstAttempt, afterRepair };
}

export function formatValidatedSqlBundle(
  objects: Array<{
    owner: string;
    name: string;
    objectType: string;
    sql: string;
  }>,
): string {
  return objects
    .map((object) => {
      const sql = object.sql.trim();
      if (!sql) {
        return "";
      }
      const body = sql.endsWith(";") ? sql : `${sql};`;
      return `-- ${object.owner}.${object.name} (${object.objectType})\n${body}`;
    })
    .filter((chunk) => chunk.length > 0)
    .join("\n\n");
}

function percent(passed: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.round((100 * passed) / total);
}

function typePassed(object: ReportObjectInput): boolean {
  return object.status === "VALIDATED" || object.testStatus === "PASSED";
}

export function scoreReadiness(input: {
  schemaPassed: number;
  schemaTotal: number;
  dataPassed?: number;
  dataTotal?: number;
  compilePassed: number;
  compileTotal: number;
  behaviorPassed: number;
  behaviorTotal: number;
  performancePassed?: number;
  performanceTotal?: number;
  constraintsPassed: number;
  constraintsTotal: number;
  sequencesPassed: number;
  sequencesTotal: number;
  reviewRequired: number;
  redesignRequired: number;
  blockingIssues: number;
}): ReadinessBreakdown {
  const parts: Record<ReadinessDimension, number | null> = {
    schema: percent(input.schemaPassed, input.schemaTotal),
    data: percent(input.dataPassed ?? 0, input.dataTotal ?? 0),
    compile: percent(input.compilePassed, input.compileTotal),
    behavior: percent(input.behaviorPassed, input.behaviorTotal),
    performance: percent(input.performancePassed ?? 0, input.performanceTotal ?? 0),
    constraints: percent(input.constraintsPassed, input.constraintsTotal),
    sequences: percent(input.sequencesPassed, input.sequencesTotal),
  };
  let weighted = 0;
  let weightSum = 0;
  for (const [name, value] of Object.entries(parts) as Array<[ReadinessDimension, number | null]>) {
    if (value === null) {
      continue;
    }
    const weight = READINESS_WEIGHTS[name];
    weighted += value * weight;
    weightSum += weight;
  }
  return {
    schemaPercent: parts.schema,
    dataPercent: parts.data,
    compilePercent: parts.compile,
    behaviorPercent: parts.behavior,
    performancePercent: parts.performance,
    constraintsPercent: parts.constraints,
    sequencesPercent: parts.sequences,
    overallPercent: weightSum > 0 ? Math.round(weighted / weightSum) : 0,
    reviewRequired: input.reviewRequired,
    redesignRequired: input.redesignRequired,
    blockingIssues: input.blockingIssues,
    notes: readinessNotes(parts.data, parts.performance),
  };
}

function readinessNotes(dataPercent: number | null, performancePercent: number | null): string[] {
  const notes = [
    "Overall readiness is a weighted average of completed dimensions.",
    "REVIEW_REQUIRED, REDESIGN_REQUIRED, FAILED, and waiting dependencies stay visible even when the score is high.",
    "Compile success is not VALIDATED and is not READY_FOR_DEPLOYMENT.",
  ];
  if (dataPercent === null) {
    notes.push("Data is omitted until a data-copy run produces row-count samples.");
  } else {
    notes.push("Data score is Oracle vs PostgreSQL row-count match after copy. No AI on rows.");
  }
  if (performancePercent === null) {
    notes.push("Performance is omitted until later samples exist.");
  }
  return notes;
}

export function gateStatusForReport(input: {
  runStatus: MigrationRunStatus;
  blockingCount: number;
  pendingCount: number;
  validatedCount: number;
  inScopeCount: number;
}): ReportGateStatus {
  if (input.runStatus === "QUEUED" || input.runStatus === "RUNNING") {
    return "IN_PROGRESS";
  }
  if (input.runStatus === "CANCELLED") {
    return "BLOCKED";
  }
  if (input.blockingCount > 0) {
    return "BLOCKED";
  }
  if (input.pendingCount > 0 || input.validatedCount < input.inScopeCount) {
    return "IN_PROGRESS";
  }
  return "READY_FOR_DEPLOYMENT";
}

function blockingDetail(object: ReportObjectInput): string {
  if (object.status === "WAITING_DEPENDENCY") {
    return "Waiting on an out-of-scope or deferred prerequisite";
  }
  if (object.status === "REDESIGN_REQUIRED") {
    return "Oracle behavior does not map safely; redesign is required";
  }
  if (object.status === "REVIEW_REQUIRED") {
    const detail = object.testError ?? object.compileError;
    if (detail) {
      return detail;
    }
    return "Needs review (HIGH-risk SQL or compile/test did not fully clear). Open the object for SQL/warnings, fix deps, re-run Views.";
  }
  return object.testError ?? object.compileError ?? object.status;
}

/** Parse PostgreSQL `relation "…" does not exist` into OWNER.NAME. */
export function missingRelationFromError(
  message: string | null | undefined,
  defaultOwner?: string | null,
): {
  owner: string;
  name: string;
} | null {
  if (!message) {
    return null;
  }
  const qualified = /relation\s+"([^".]+)\.([^"]+)"\s+does\s+not\s+exist/i.exec(message);
  if (qualified?.[1] && qualified[2]) {
    return { owner: qualified[1].toUpperCase(), name: qualified[2].toUpperCase() };
  }
  const bare = /relation\s+"([^".]+)"\s+does\s+not\s+exist/i.exec(message);
  if (bare?.[1] && defaultOwner && defaultOwner.trim().length > 0) {
    return { owner: defaultOwner.toUpperCase(), name: bare[1].toUpperCase() };
  }
  return null;
}

/** Detect OWNER.NAME of a table that must be added to scope for this blocker. */
export function missingScopeTable(object: ReportObjectInput): {
  owner: string;
  name: string;
} | null {
  const detail = `${object.compileError ?? ""}\n${object.testError ?? ""}`;
  const fromError = missingRelationFromError(detail, object.owner);
  if (fromError) {
    return fromError;
  }
  const alter =
    /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?([A-Za-z_][\w$]*)"?\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/i.exec(
      object.targetSql ?? "",
    );
  if (
    String(object.objectType).toUpperCase() === "CONSTRAINT" &&
    /not in SCHEMA scope/i.test(detail) &&
    alter?.[1] &&
    alter[2]
  ) {
    return { owner: alter[1].toUpperCase(), name: alter[2].toUpperCase() };
  }
  if (
    String(object.objectType).toUpperCase() === "CONSTRAINT" &&
    object.tableName &&
    /does not exist|not in SCHEMA scope/i.test(detail)
  ) {
    return {
      owner: object.owner.toUpperCase(),
      name: object.tableName.replace(/^"|"$/g, "").toUpperCase(),
    };
  }
  return null;
}

export function buildMigrationReport(input: BuildMigrationReportInput): MigrationReportDto {
  const byStatus: Record<string, number> = {};
  const byReconcileAction: Record<string, number> = {};
  const byType: Record<string, { total: number; validated: number }> = {};
  const blocking: MigrationReportDto["blocking"] = [];
  const reviewRequired: MigrationReportDto["reviewRequired"] = [];
  const redesignRequired: MigrationReportDto["redesignRequired"] = [];
  let schemaTotal = 0;
  let schemaPassed = 0;
  let compileTotal = 0;
  let compilePassed = 0;
  let behaviorTotal = 0;
  let behaviorPassed = 0;
  let constraintsTotal = 0;
  let constraintsPassed = 0;
  let sequencesTotal = 0;
  let sequencesPassed = 0;
  let validatedCount = 0;
  let deferredCount = 0;
  let pendingCount = 0;

  for (const object of input.objects) {
    byStatus[object.status] = (byStatus[object.status] ?? 0) + 1;
    if (object.reconcileAction) {
      byReconcileAction[object.reconcileAction] =
        (byReconcileAction[object.reconcileAction] ?? 0) + 1;
    }
    const typeBucket = byType[object.objectType] ?? { total: 0, validated: 0 };
    typeBucket.total += 1;
    if (object.status === "VALIDATED") {
      typeBucket.validated += 1;
      validatedCount += 1;
    }
    byType[object.objectType] = typeBucket;

    if (object.deferred) {
      deferredCount += 1;
      continue;
    }
    if (object.compileStatus) {
      compileTotal += 1;
      if (object.compileStatus === "PASSED" || object.compileStatus === "SKIPPED") {
        compilePassed += 1;
      }
    }
    if (object.testStatus === "PASSED" || object.testStatus === "FAILED") {
      behaviorTotal += 1;
      if (object.testStatus === "PASSED") {
        behaviorPassed += 1;
      }
    }
    const type = String(object.objectType).toUpperCase();
    if (type === "TABLE") {
      schemaTotal += 1;
      if (typePassed(object)) {
        schemaPassed += 1;
      }
    }
    if (type === "CONSTRAINT") {
      constraintsTotal += 1;
      if (typePassed(object)) {
        constraintsPassed += 1;
      }
    }
    if (type === "SEQUENCE") {
      sequencesTotal += 1;
      if (typePassed(object)) {
        sequencesPassed += 1;
      }
    }
    if (isReportBlockingStatus(object.status)) {
      const missing = missingScopeTable(object);
      const item = {
        id: object.id,
        owner: object.owner,
        name: object.name,
        objectType: object.objectType,
        status: object.status,
        detail: blockingDetail(object),
        missingTable: missing ? `${missing.owner}.${missing.name}` : null,
      };
      blocking.push(item);
      if (object.status === "REVIEW_REQUIRED") {
        reviewRequired.push(item);
      }
      if (object.status === "REDESIGN_REQUIRED") {
        redesignRequired.push(item);
      }
    } else if (object.status !== "VALIDATED") {
      pendingCount += 1;
    }
  }

  const inScopeCount = input.objects.length - deferredCount;
  const readiness = scoreReadiness({
    schemaPassed,
    schemaTotal,
    dataPassed: input.dataPassed,
    dataTotal: input.dataTotal,
    compilePassed,
    compileTotal,
    behaviorPassed,
    behaviorTotal,
    constraintsPassed,
    constraintsTotal,
    sequencesPassed,
    sequencesTotal,
    reviewRequired: reviewRequired.length,
    redesignRequired: redesignRequired.length,
    blockingIssues: blocking.length,
  });
  const gateStatus = gateStatusForReport({
    runStatus: input.runStatus,
    blockingCount: blocking.length,
    pendingCount,
    validatedCount,
    inScopeCount,
  });

  return {
    projectId: input.projectId,
    runId: input.runId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gateStatus,
    strategy: input.strategy,
    mappingRulesVersion: input.mappingRulesVersion || MAPPING_RULES_VERSION,
    promptVersion: AI_PROMPT_VERSION,
    objectCount: input.objects.length,
    inScopeCount,
    validatedCount,
    deferredCount,
    blockingCount: blocking.length,
    readiness,
    byStatus,
    byReconcileAction,
    byType,
    blocking,
    reviewRequired,
    redesignRequired,
    tests: {
      passed: input.testsPassed,
      failed: input.testsFailed,
      skipped: input.testsSkipped,
    },
    compile: {
      firstAttempt: input.compileFirstAttempt,
      afterRepair: input.compileAfterRepair,
      passed: compilePassed,
      failed: compileTotal - compilePassed,
    },
    graph: input.graph,
    ai: {
      convertCount: input.aiConvertCount,
      fixCount: input.aiFixCount,
      verifyCount: input.aiVerifyCount,
    },
  };
}
