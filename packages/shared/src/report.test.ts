import { describe, expect, test } from "bun:test";
import {
  buildMigrationReport,
  countCompileOutcomes,
  dataCopyReadiness,
  formatValidatedSqlBundle,
  gateStatusForReport,
  scoreReadiness,
} from "./report";

const table = {
  id: "11111111-1111-1111-1111-111111111111",
  owner: "HR",
  name: "EMP",
  objectType: "TABLE",
  status: "VALIDATED" as const,
  riskLevel: "LOW" as const,
  compileStatus: "PASSED" as const,
  testStatus: "PASSED" as const,
  compileError: null,
  testError: null,
  deferred: false,
  attemptCount: 1,
  reconcileAction: null,
};

describe("scoreReadiness", () => {
  test("omits dimensions with no samples and is not percent compiled", () => {
    const readiness = scoreReadiness({
      schemaPassed: 10,
      schemaTotal: 10,
      compilePassed: 10,
      compileTotal: 10,
      behaviorPassed: 0,
      behaviorTotal: 0,
      constraintsPassed: 0,
      constraintsTotal: 0,
      sequencesPassed: 0,
      sequencesTotal: 0,
      reviewRequired: 0,
      redesignRequired: 0,
      blockingIssues: 0,
    });
    expect(readiness.compilePercent).toBe(100);
    expect(readiness.behaviorPercent).toBeNull();
    expect(readiness.dataPercent).toBeNull();
    expect(readiness.performancePercent).toBeNull();
    expect(readiness.overallPercent).toBe(100);
  });

  test("includes data when row-count samples exist", () => {
    const readiness = scoreReadiness({
      schemaPassed: 10,
      schemaTotal: 10,
      dataPassed: 4,
      dataTotal: 5,
      compilePassed: 10,
      compileTotal: 10,
      behaviorPassed: 0,
      behaviorTotal: 0,
      constraintsPassed: 0,
      constraintsTotal: 0,
      sequencesPassed: 0,
      sequencesTotal: 0,
      reviewRequired: 0,
      redesignRequired: 0,
      blockingIssues: 0,
    });
    expect(readiness.dataPercent).toBe(80);
    expect(readiness.notes.some((note) => note.includes("row-count"))).toBe(true);
  });
});

describe("dataCopyReadiness", () => {
  test("scores only tables that have both Oracle and PostgreSQL counts", () => {
    expect(
      dataCopyReadiness([
        { status: "SUCCEEDED", oracleRows: 10, postgresRows: 10 },
        { status: "SUCCEEDED", oracleRows: 5, postgresRows: 4 },
        { status: "FAILED", oracleRows: null, postgresRows: null },
      ]),
    ).toEqual({ passed: 1, total: 2 });
  });
});

describe("gateStatusForReport", () => {
  test("blockers prevent READY_FOR_DEPLOYMENT even when most objects compiled", () => {
    expect(
      gateStatusForReport({
        runStatus: "SUCCEEDED",
        blockingCount: 1,
        pendingCount: 0,
        validatedCount: 99,
        inScopeCount: 100,
      }),
    ).toBe("BLOCKED");
    expect(
      gateStatusForReport({
        runStatus: "SUCCEEDED",
        blockingCount: 0,
        pendingCount: 0,
        validatedCount: 2,
        inScopeCount: 2,
      }),
    ).toBe("READY_FOR_DEPLOYMENT");
  });
});

describe("buildMigrationReport", () => {
  test("lists review-required objects as blockers and does not treat compile as validated", () => {
    const report = buildMigrationReport({
      projectId: "22222222-2222-2222-2222-222222222222",
      runId: "33333333-3333-3333-3333-333333333333",
      strategy: "FAST",
      mappingRulesVersion: "ora2pg-compat-v1",
      runStatus: "SUCCEEDED",
      objects: [
        table,
        {
          ...table,
          id: "44444444-4444-4444-4444-444444444444",
          name: "EMP_V",
          objectType: "VIEW",
          status: "REVIEW_REQUIRED",
          compileStatus: "PASSED",
          testStatus: "FAILED",
          testError: "Missing columns: dept_id",
        },
      ],
      graph: {
        nodeCount: 2,
        edgeCount: 1,
        layerCount: 2,
        cycleCount: 0,
        waitingCount: 0,
      },
      testsPassed: 1,
      testsFailed: 1,
      testsSkipped: 0,
      compileFirstAttempt: 1,
      compileAfterRepair: 1,
      aiConvertCount: 0,
      aiFixCount: 0,
      aiVerifyCount: 0,
      generatedAt: "2026-09-10T10:00:00.000Z",
    });
    expect(report.gateStatus).toBe("BLOCKED");
    expect(report.validatedCount).toBe(1);
    expect(report.blocking[0]?.name).toBe("EMP_V");
    expect(report.readiness.compilePercent).toBe(100);
    expect(report.readiness.overallPercent).toBeLessThan(100);
  });
});

describe("countCompileOutcomes", () => {
  test("counts earliest pass as first attempt or after repair", () => {
    expect(
      countCompileOutcomes([
        { objectId: "a", attemptNumber: 1, status: "PASSED" },
        { objectId: "b", attemptNumber: 1, status: "FAILED" },
        { objectId: "b", attemptNumber: 2, status: "PASSED" },
        { objectId: "c", attemptNumber: 3, status: "FAILED" },
      ]),
    ).toEqual({ firstAttempt: 1, afterRepair: 1 });
  });
});

describe("formatValidatedSqlBundle", () => {
  test("joins DAG-ordered DDL with object headers and no extra secrets", () => {
    const sql = formatValidatedSqlBundle([
      { owner: "HR", name: "EMP", objectType: "TABLE", sql: "CREATE TABLE emp ()" },
      {
        owner: "HR",
        name: "EMP_PK",
        objectType: "INDEX",
        sql: "CREATE INDEX emp_pk ON emp (id);",
      },
    ]);
    expect(sql).toContain("-- HR.EMP (TABLE)\nCREATE TABLE emp ();");
    expect(sql).toContain("-- HR.EMP_PK (INDEX)\nCREATE INDEX emp_pk ON emp (id);");
    expect(sql).not.toMatch(/password|secret|api[_-]?key/i);
  });
});
