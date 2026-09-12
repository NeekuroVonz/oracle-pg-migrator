import { describe, expect, test } from "bun:test";
import { toAiProviderDto, toConnectionDto, toDeployRunDto, toMigrationReportDto } from "./mappers";
import type { ConnectionRow } from "./schema";

describe("connection mapper", () => {
  test("never includes a password field", () => {
    const row: ConnectionRow = {
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      role: "SOURCE",
      engine: "ORACLE",
      accessMode: "READ_ONLY",
      allowWrite: false,
      displayName: "CLV Oracle",
      host: "10.0.0.8",
      port: 1521,
      username: "migrator_ro",
      passwordCiphertext: "v1:should-never-leak",
      oracleConnectType: "SERVICE_NAME",
      oracleSid: null,
      oracleServiceName: "CLV",
      oracleTns: null,
      oracleSchemas: ["CLV"],
      oracleVersionOverride: null,
      connectionTimeoutMs: 15000,
      databaseName: null,
      schemaName: null,
      sslMode: null,
      postgresVersion: null,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    };
    const dto = toConnectionDto(row);
    expect(dto.hasPassword).toBe(true);
    expect(dto.allowWrite).toBe(false);
    expect(dto.accessMode).toBe("READ_ONLY");
    expect(JSON.stringify(dto)).not.toContain("password");
    expect(JSON.stringify(dto)).not.toContain("v1:should-never-leak");
  });
});

describe("migration report mapper", () => {
  test("parses the stored payload and never includes secrets", () => {
    const dto = toMigrationReportDto({
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      runId: "33333333-3333-3333-3333-333333333333",
      gateStatus: "BLOCKED",
      readinessPercent: 80,
      payload: {
        projectId: "22222222-2222-2222-2222-222222222222",
        runId: "33333333-3333-3333-3333-333333333333",
        generatedAt: "2026-09-10T10:00:00.000Z",
        gateStatus: "BLOCKED",
        strategy: "FAST",
        mappingRulesVersion: "ora2pg-compat-v1",
        promptVersion: "v1",
        objectCount: 1,
        inScopeCount: 1,
        validatedCount: 0,
        deferredCount: 0,
        blockingCount: 1,
        readiness: {
          schemaPercent: null,
          dataPercent: null,
          compilePercent: 100,
          behaviorPercent: null,
          performancePercent: null,
          constraintsPercent: null,
          sequencesPercent: null,
          overallPercent: 80,
          reviewRequired: 1,
          redesignRequired: 0,
          blockingIssues: 1,
          notes: ["Compile success is not VALIDATED and is not READY_FOR_DEPLOYMENT."],
        },
        byStatus: { REVIEW_REQUIRED: 1 },
        byReconcileAction: { REVIEW_REQUIRED: 1 },
        byType: { VIEW: { total: 1, validated: 0 } },
        blocking: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            owner: "HR",
            name: "EMP_V",
            objectType: "VIEW",
            status: "REVIEW_REQUIRED",
            detail: "review",
          },
        ],
        reviewRequired: [],
        redesignRequired: [],
        tests: { passed: 0, failed: 0, skipped: 0 },
        compile: { firstAttempt: 1, afterRepair: 0, passed: 1, failed: 0 },
        graph: {
          nodeCount: 1,
          edgeCount: 0,
          layerCount: 1,
          cycleCount: 0,
          waitingCount: 0,
        },
        ai: { convertCount: 0, fixCount: 0, verifyCount: 0 },
      },
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(dto.gateStatus).toBe("BLOCKED");
    expect(JSON.stringify(dto)).not.toMatch(/password|secret|apiKey/i);
  });
});

describe("AI provider mapper", () => {
  test("never includes an API key or ciphertext", () => {
    const dto = toAiProviderDto({
      id: "11111111-1111-1111-1111-111111111111",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyCiphertext: "v1:should-never-leak",
      enabled: true,
      roleConvert: true,
      roleFix: true,
      roleVerify: true,
      lastTestedAt: null,
      lastTestStatus: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    });
    expect(dto.hasApiKey).toBe(true);
    expect("apiKey" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("apiKeyCiphertext");
    expect(JSON.stringify(dto)).not.toContain("v1:should-never-leak");
  });
});

describe("deploy mapper", () => {
  test("never includes SQL bodies or secrets", () => {
    const dto = toDeployRunDto(
      {
        id: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
        conversionRunId: "33333333-3333-3333-3333-333333333333",
        status: "SUCCEEDED",
        gateStatus: "READY_FOR_DEPLOYMENT",
        objectCount: 1,
        deployedCount: 1,
        failedCount: 0,
        errorMessage: null,
        startedAt: new Date("2026-09-11T00:00:00.000Z"),
        finishedAt: new Date("2026-09-11T00:01:00.000Z"),
        createdAt: new Date("2026-09-11T00:00:00.000Z"),
        updatedAt: new Date("2026-09-11T00:01:00.000Z"),
      },
      [
        {
          id: "44444444-4444-4444-4444-444444444444",
          deployRunId: "11111111-1111-1111-1111-111111111111",
          objectId: "55555555-5555-5555-5555-555555555555",
          owner: "HR",
          name: "EMP",
          objectType: "TABLE",
          targetSchema: "hr",
          targetName: "emp",
          sortIndex: 0,
          sql: "CREATE TABLE emp (password text);",
          status: "SUCCEEDED",
          errorMessage: null,
          createdAt: new Date("2026-09-11T00:00:00.000Z"),
          updatedAt: new Date("2026-09-11T00:01:00.000Z"),
        },
      ],
    );
    const json = JSON.stringify(dto);
    expect(json).not.toContain("CREATE TABLE");
    expect(json).not.toMatch(/"sql"/);
    expect(dto.objects[0]?.targetName).toBe("emp");
  });
});
