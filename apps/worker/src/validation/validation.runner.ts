import {
  objectStatusAfterAiExhausted,
  objectStatusAfterCompile,
  objectStatusAfterTests,
  objectStatusAfterVerify,
  redactErrorMessage,
} from "@migrator/ai-core";
import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  TestAttemptsRepository,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { buildObjectDag, orderByDag } from "@migrator/dependency-graph";
import { createValidatorPool, type ValidatorPool } from "@migrator/docker-manager";
import { toPrimaryKeyUsingIndexSql } from "@migrator/ora2pg";
import { reconcileObject, sandboxSqlForAction } from "@migrator/postgres";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  type DiscoveredObjectMetadata,
  isConversionStopped,
  isDeterministicSchemaType,
  isPlsqlObjectType,
  type MigrationStrategy,
  type ObjectStatus,
  parseRunTracks,
  type ReportingJobData,
} from "@migrator/shared";
import {
  type CompileResult,
  compileSql,
  isDuplicateObjectError,
  runStructuralTests,
} from "@migrator/validator";
import { Client } from "pg";
import type { AiRuntime } from "../ai/runtime";
import { connectProjectTarget } from "../target-postgres";

async function enqueueReport(redisUrl: string, projectId: string, runId: string): Promise<void> {
  const queue = createQueue<ReportingJobData>(QUEUE_NAMES.reporting, redisUrl);
  try {
    await queue.add(
      "report",
      { projectId, runId },
      { jobId: `report-${runId}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
    );
  } finally {
    await queue.close();
  }
}

let sharedPool: ValidatorPool | undefined;

function poolFromEnv(env: AppEnv): ValidatorPool {
  sharedPool ??= createValidatorPool({
    mode: env.VALIDATOR_MODE,
    size: env.VALIDATOR_POOL_SIZE,
    databaseUrl: env.VALIDATOR_DATABASE_URL,
    dockerImage: env.VALIDATOR_DOCKER_IMAGE,
    statementTimeoutMs: env.VALIDATOR_STATEMENT_TIMEOUT_MS,
  });
  return sharedPool;
}

type RunObject = Awaited<ReturnType<MigrationRunObjectsRepository["listObjects"]>>[number];

function isFatalAiProviderError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }
  return (
    /AI provider HTTP (401|403|404|429)\b/i.test(message) ||
    /ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)
  );
}

/** PK already applied via TABLE DDL (or a prior constraint) — not a real defect. */
function isBenignPrimaryKeyDuplicate(compiled: {
  errorCode?: string | null;
  errorMessage?: string | null;
  diagnostics?: Array<{ code?: string | null; message?: string | null }>;
}): boolean {
  const messages = [
    compiled.errorMessage,
    ...(compiled.diagnostics ?? []).map((item) => item.message),
  ];
  const codes = [compiled.errorCode, ...(compiled.diagnostics ?? []).map((item) => item.code)];
  if (codes.some((code) => code === "42P16" || code === "42710")) {
    return true;
  }
  return messages.some(
    (message) =>
      Boolean(message) &&
      (/multiple primary keys/i.test(message!) ||
        /constraint .+ already exists/i.test(message!)),
  );
}

function stickyReview(object: {
  objectType: string;
  riskLevel: string | null;
  status: string;
}): boolean {
  // Views: only HIGH-risk Oracle constructs stay sticky. Convert warnings alone must not
  // block VALIDATED after sandbox compile + tests pass.
  const type = String(object.objectType).toUpperCase();
  if (type === "VIEW" || type === "MATERIALIZED_VIEW") {
    return object.riskLevel === "HIGH";
  }
  if (isDeterministicSchemaType(object.objectType)) {
    return false;
  }
  return object.riskLevel === "HIGH" || object.status === "REVIEW_REQUIRED";
}

async function persistCompile(input: {
  runId: string;
  object: RunObject;
  sql: string;
  compiled: CompileResult;
  status: ObjectStatus;
  objects: DiscoveredObjectsRepository;
  validations: ValidationAttemptsRepository;
}): Promise<void> {
  const attemptNumber = await input.validations.nextAttemptNumber(input.runId, input.object.id);
  await input.validations.append({
    runId: input.runId,
    objectId: input.object.id,
    attemptNumber,
    generatedSql: input.sql,
    status: input.compiled.ok ? "PASSED" : "FAILED",
    errorCode: input.compiled.errorCode,
    errorMessage: input.compiled.errorMessage,
    details: {
      diagnostics: input.compiled.diagnostics,
      statements: input.compiled.statements,
    },
    durationMs: input.compiled.durationMs,
  });
  await input.objects.updateConversion(input.object.id, {
    status: input.status,
    compileStatus: input.compiled.ok ? "PASSED" : "FAILED",
    compileError: input.compiled.errorMessage,
    ...(input.compiled.ok
      ? {}
      : { testStatus: null, testError: null }),
  });
}

async function persistTest(input: {
  runId: string;
  object: RunObject;
  tests: Awaited<ReturnType<typeof runStructuralTests>>;
  status: ObjectStatus;
  objects: DiscoveredObjectsRepository;
  testAttempts: TestAttemptsRepository;
}): Promise<void> {
  const attemptNumber = await input.testAttempts.nextAttemptNumber(input.runId, input.object.id);
  await input.testAttempts.append({
    runId: input.runId,
    objectId: input.object.id,
    attemptNumber,
    status: input.tests.status,
    errorCode: input.tests.errorCode,
    errorMessage: input.tests.errorMessage,
    details: { checks: input.tests.checks, skipped: input.tests.skipped },
    durationMs: input.tests.durationMs,
  });
  await input.objects.updateConversion(input.object.id, {
    status: input.status,
    testStatus: input.tests.status,
    testError: input.tests.errorMessage,
  });
}

export async function runValidation(input: {
  env: AppEnv;
  cipher: SecretCipher;
  projectId: string;
  runId: string;
  runs: MigrationRunsRepository;
  runObjects: MigrationRunObjectsRepository;
  objects: DiscoveredObjectsRepository;
  dependencies: ObjectDependenciesRepository;
  validations: ValidationAttemptsRepository;
  attempts: ConversionAttemptsRepository;
  testAttempts: TestAttemptsRepository;
  audit: AuditRepository;
  connections: ConnectionsRepository;
  ai: AiRuntime;
}): Promise<void> {
  const existing = await input.runs.getById(input.runId);
  if (isConversionStopped(existing)) {
    await input.runs.update(input.runId, {
      status: "CANCELLED",
      errorMessage: "Stopped by user",
      finishedAt: new Date(),
    });
    return;
  }
  const pool = poolFromEnv(input.env);
  const slot = await pool.acquire();
  const client = new Client({
    connectionString: slot.connectionString,
    connectionTimeoutMillis: 8000,
  });
  let compiledCount = 0;
  let compileFailedCount = 0;
  let testedCount = 0;
  let testFailedCount = 0;
  let aiFixCount = 0;
  let aiVerifyCount = 0;
  let aiProviderError: string | null = null;
  try {
    await client.connect();
    const target = await connectProjectTarget({
      projectId: input.projectId,
      connections: input.connections,
      cipher: input.cipher,
      statementTimeoutMs: input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
    });
    try {
      const run = await input.runs.getById(input.runId);
      if (isConversionStopped(run)) {
        await input.runs.update(input.runId, {
          status: "CANCELLED",
          errorMessage: "Stopped by user",
          finishedAt: new Date(),
        });
        return;
      }
      const strategy = (run?.strategy ?? "FAST") as MigrationStrategy;
      const tracks = parseRunTracks(run?.stats);
      const useAiFix = tracks.includes("PLSQL") && Boolean(input.ai.fix);
      const useAiVerify =
        tracks.includes("PLSQL") &&
        Boolean(input.ai.verify) &&
        (strategy === "BALANCED" || strategy === "MAXIMUM_ACCURACY");
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
      const compilable = orderByDag(
        members.filter(
          (row) => !row.deferred && row.status !== "WAITING_DEPENDENCY" && Boolean(row.targetSql),
        ),
        dag.order,
      );

      const pending = [...compilable];
      for (let pass = 0; pass < 2 && pending.length > 0; pass += 1) {
        const remaining: typeof pending = [];
        for (const object of pending) {
          const latestRun = await input.runs.getById(input.runId);
          if (isConversionStopped(latestRun)) {
            await input.runs.update(input.runId, {
              status: "CANCELLED",
              errorMessage: "Stopped by user",
              compiledCount,
              compileFailedCount,
              testedCount,
              testFailedCount,
              stats: {
                ...(latestRun?.stats ?? {}),
                tracks,
                cancelRequested: true,
              },
              finishedAt: new Date(),
            });
            await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
            return;
          }
          const sql = object.targetSql;
          if (!sql) {
            continue;
          }
          const recon = await reconcileObject({
            executor: target,
            objectType: object.objectType,
            schema: object.targetSchema ?? "",
            name: object.targetName ?? "",
            desiredSql: sql,
            previousDesiredHash: object.desiredShapeHash,
            previousTargetHash: object.targetShapeHash,
            estimatedRowCount: object.estimatedRowCount,
          });
          await input.objects.updateConversion(object.id, {
            targetState: recon.targetState,
            reconcileAction: recon.reconcileAction,
            previousDesiredShapeHash: object.desiredShapeHash,
            desiredShapeHash: recon.desiredHash,
            previousTargetShapeHash: object.targetShapeHash,
            targetShapeHash: recon.targetHash,
            reconcileSql: recon.reconcileSql,
            reconcileDiff: {
              reason: recon.reason,
              destructive: recon.diff.destructive,
              changes: recon.diff.changes,
            },
          });
          object.reconcileAction = recon.reconcileAction;
          object.targetState = recon.targetState;
          object.reconcileSql = recon.reconcileSql;
          object.desiredShapeHash = recon.desiredHash;
          object.targetShapeHash = recon.targetHash;

          let sandboxSql =
            sandboxSqlForAction({
              action: recon.reconcileAction,
              desiredSql: sql,
              reconcileSql: recon.reconcileSql,
              cloneSql: recon.cloneSql,
            }) ?? sql;
          if (!sandboxSql) {
            await input.objects.updateConversion(object.id, {
              status: "REVIEW_REQUIRED",
              compileError: recon.reason,
            });
            object.status = "REVIEW_REQUIRED";
            continue;
          }
          let compiled = await compileSql(
            client,
            sandboxSql,
            input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
            {
              ignoreDuplicateObjects:
                recon.reconcileAction !== "CREATE_REQUIRED" ||
                object.objectType === "INDEX",
              searchPath: object.targetSchema ?? undefined,
            },
          );
          if (
            !compiled.ok &&
            object.objectType === "CONSTRAINT" &&
            isDuplicateObjectError(compiled)
          ) {
            if (isBenignPrimaryKeyDuplicate(compiled)) {
              compiled = {
                ...compiled,
                ok: true,
                errorCode: null,
                errorMessage: null,
                diagnostics: [],
              };
            } else {
              const usingIndex = toPrimaryKeyUsingIndexSql(sandboxSql);
              if (usingIndex) {
                const retry = await compileSql(
                  client,
                  usingIndex,
                  input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
                  {
                    ignoreDuplicateObjects: false,
                    searchPath: object.targetSchema ?? undefined,
                  },
                );
                if (retry.ok || isBenignPrimaryKeyDuplicate(retry)) {
                  compiled = retry.ok
                    ? retry
                    : {
                        ...retry,
                        ok: true,
                        errorCode: null,
                        errorMessage: null,
                        diagnostics: [],
                      };
                  sandboxSql = usingIndex;
                }
              }
            }
          }
          // INDEX duplicates are safe to ignore; bare CONSTRAINT name collisions are not.
          if (
            !compiled.ok &&
            object.objectType !== "CONSTRAINT" &&
            isDuplicateObjectError(compiled)
          ) {
            compiled = {
              ...compiled,
              ok: true,
              errorCode: null,
              errorMessage: null,
              diagnostics: [],
            };
          }
          if (
            !compiled.ok &&
            object.objectType === "CONSTRAINT" &&
            /does not exist/i.test(compiled.errorMessage ?? "")
          ) {
            await input.objects.updateConversion(object.id, {
              status: "REVIEW_REQUIRED",
              compileStatus: "SKIPPED",
              compileError: `${compiled.errorMessage} (referenced table not in SCHEMA scope)`,
            });
            object.status = "REVIEW_REQUIRED";
            object.compileStatus = "SKIPPED";
            object.compileError = `${compiled.errorMessage} (referenced table not in SCHEMA scope)`;
            continue;
          }
          if (
            !compiled.ok &&
            pass === 0 &&
            recon.reconcileAction === "CREATE_REQUIRED" &&
            !isDuplicateObjectError(compiled)
          ) {
            remaining.push(object);
            continue;
          }
          if (compiled.ok) {
            compiledCount += 1;
          } else {
            compileFailedCount += 1;
          }
          const status = compiled.ok
            ? objectStatusAfterCompile({
                compilePassed: true,
                highRisk: !isDeterministicSchemaType(object.objectType) && object.riskLevel === "HIGH",
                reviewRequired: stickyReview(object),
              })
            : recon.reconcileAction === "UPDATE_REQUIRED" ||
                recon.reconcileAction === "REPLACE_REQUIRED"
              ? "REVIEW_REQUIRED"
              : objectStatusAfterCompile({
                  compilePassed: false,
                  highRisk: !isDeterministicSchemaType(object.objectType) && object.riskLevel === "HIGH",
                  reviewRequired: stickyReview(object),
                });
          await persistCompile({
            runId: input.runId,
            object,
            sql: sandboxSql,
            compiled,
            status,
            objects: input.objects,
            validations: input.validations,
          });
          object.status = status;
          object.compileStatus = compiled.ok ? "PASSED" : "FAILED";
          object.compileError = compiled.errorMessage;
        }
        pending.splice(0, pending.length, ...remaining);
      }

      if (useAiFix && input.ai.fix) {
        const fixer = input.ai.fix;
        const failed = compilable.filter(
          (row) =>
            isPlsqlObjectType(row.objectType) &&
            row.compileStatus === "FAILED" &&
            row.targetSql &&
            row.reconcileAction === "CREATE_REQUIRED" &&
            !isDuplicateObjectError({ errorMessage: row.compileError }),
        );
        for (const object of failed) {
          if (aiProviderError) {
            break;
          }
          const latestRun = await input.runs.getById(input.runId);
          if (isConversionStopped(latestRun)) {
            await input.runs.update(input.runId, {
              status: "CANCELLED",
              errorMessage: "Stopped by user",
              compiledCount,
              compileFailedCount,
              testedCount,
              testFailedCount,
              stats: {
                ...(latestRun?.stats ?? {}),
                tracks,
                aiFixCount,
                cancelRequested: true,
              },
              finishedAt: new Date(),
            });
            await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
            return;
          }
          let sql = object.targetSql;
          if (!sql) {
            continue;
          }
          let lastCompile = object.compileError;
          let passed = false;
          let aiAttempts = await input.attempts.countByConverter(input.runId, object.id, "AI");
          while (aiAttempts < input.ai.maxAttempts) {
            const started = Date.now();
            await input.objects.updateConversion(object.id, { status: "CONVERTING_AI" });
            try {
              const fixed = await fixer.fix({
                objectType: object.objectType,
                owner: object.owner,
                name: object.name,
                sourceText: object.sourceText ?? "",
                currentSql: sql,
                compileError: lastCompile,
              });
              const attemptNumber = await input.attempts.nextAttemptNumber(input.runId, object.id);
              await input.attempts.append({
                runId: input.runId,
                objectId: object.id,
                attemptNumber,
                converterType: "AI",
                mappingRulesVersion: fixed.promptVersion,
                sourceHash: object.sourceHash,
                generatedSql: fixed.sql,
                warnings: fixed.warnings,
                riskFlags: [],
                status: fixed.status,
                errorMessage: fixed.notes,
                durationMs: Date.now() - started,
              });
              aiFixCount += 1;
              aiAttempts += 1;
              if (isFatalAiProviderError(fixed.notes)) {
                aiProviderError = fixed.notes;
                break;
              }
              if (!fixed.sql) {
                continue;
              }
              sql = fixed.sql;
              object.targetSql = sql;
              await input.objects.updateConversion(object.id, {
                targetSql: sql,
                attemptCount: attemptNumber,
                status: "COMPILING",
              });
              const compiled = await compileSql(
                client,
                sql,
                input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
                { searchPath: object.targetSchema ?? undefined },
              );
              lastCompile = compiled.errorMessage;
              const status = compiled.ok
                ? objectStatusAfterCompile({
                    compilePassed: true,
                    highRisk: object.riskLevel === "HIGH",
                    reviewRequired: fixed.status === "REVIEW_REQUIRED",
                  })
                : "FAILED";
              await persistCompile({
                runId: input.runId,
                object,
                sql,
                compiled,
                status,
                objects: input.objects,
                validations: input.validations,
              });
              object.status = status;
              object.compileStatus = compiled.ok ? "PASSED" : "FAILED";
              object.compileError = compiled.errorMessage;
              if (compiled.ok) {
                compiledCount += 1;
                compileFailedCount = Math.max(0, compileFailedCount - 1);
                passed = true;
                break;
              }
            } catch (error) {
              const message = redactErrorMessage(error);
              const attemptNumber = await input.attempts.nextAttemptNumber(input.runId, object.id);
              await input.attempts.append({
                runId: input.runId,
                objectId: object.id,
                attemptNumber,
                converterType: "AI",
                mappingRulesVersion: "ai-fixer",
                sourceHash: object.sourceHash,
                generatedSql: sql,
                warnings: [],
                riskFlags: [],
                status: "FAILED",
                errorMessage: message,
                durationMs: Date.now() - started,
              });
              aiFixCount += 1;
              aiAttempts += 1;
              if (isFatalAiProviderError(message)) {
                aiProviderError = message;
                break;
              }
            }
          }
          if (!passed && object.compileStatus === "FAILED") {
            const status = objectStatusAfterAiExhausted();
            await input.objects.updateConversion(object.id, { status });
            object.status = status;
          }
        }
      }

      for (const object of compilable.filter((row) => row.compileStatus === "PASSED")) {
        const reviewRequired = stickyReview(object);
        await input.objects.updateConversion(object.id, { status: "TESTING" });
        const metadata = (object.metadata ?? {}) as DiscoveredObjectMetadata;
        const tests = await runStructuralTests(client, {
          objectType: object.objectType,
          targetSchema: object.targetSchema,
          targetName: object.targetName,
          targetSql: object.targetSql,
          oracleColumns: metadata.columns,
          statementTimeoutMs: input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
        });
        if (!tests.skipped) {
          testedCount += 1;
          if (!tests.ok) {
            testFailedCount += 1;
          }
        }
        const testsPassed = tests.ok;
        const status = objectStatusAfterTests({
          compilePassed: true,
          testsPassed,
          highRisk: !isDeterministicSchemaType(object.objectType) && object.riskLevel === "HIGH",
          reviewRequired,
        });
        await persistTest({
          runId: input.runId,
          object,
          tests,
          status,
          objects: input.objects,
          testAttempts: input.testAttempts,
        });
        object.status = status;
        object.testStatus = tests.status;
        object.testError = tests.errorMessage;
      }

      const verifier = input.ai.verify;
      const shouldVerify = useAiVerify && Boolean(verifier);
      if (shouldVerify && verifier) {
        const targets = compilable.filter((row) => {
          if (!isPlsqlObjectType(row.objectType)) {
            return false;
          }
          if (row.compileStatus !== "PASSED" || !row.targetSql) {
            return false;
          }
          if (row.testStatus !== "PASSED") {
            return false;
          }
          if (strategy === "MAXIMUM_ACCURACY") {
            return true;
          }
          return row.riskLevel === "HIGH" || row.status === "REVIEW_REQUIRED";
        });
        for (const object of targets) {
          const latestRun = await input.runs.getById(input.runId);
          if (isConversionStopped(latestRun)) {
            await input.runs.update(input.runId, {
              status: "CANCELLED",
              errorMessage: "Stopped by user",
              compiledCount,
              compileFailedCount,
              testedCount,
              testFailedCount,
              stats: {
                ...(latestRun?.stats ?? {}),
                tracks,
                aiFixCount,
                aiVerifyCount,
                cancelRequested: true,
              },
              finishedAt: new Date(),
            });
            await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
            return;
          }
          try {
            await input.objects.updateConversion(object.id, { status: "VERIFYING" });
            const verified = await verifier.verify({
              objectType: object.objectType,
              owner: object.owner,
              name: object.name,
              sourceText: object.sourceText ?? "",
              currentSql: object.targetSql,
            });
            aiVerifyCount += 1;
            const status = objectStatusAfterVerify({
              compilePassed: true,
              testsPassed: object.testStatus === "PASSED",
              highRisk: object.riskLevel === "HIGH",
              reviewRequired: object.status === "REVIEW_REQUIRED",
              verdict: verified.verdict,
            });
            await input.objects.updateConversion(object.id, {
              status,
              compileStatus: "PASSED",
            });
            object.status = status;
          } catch (error) {
            aiVerifyCount += 1;
            await input.objects.updateConversion(object.id, {
              status: "REVIEW_REQUIRED",
              compileError: redactErrorMessage(error),
            });
            object.status = "REVIEW_REQUIRED";
          }
        }
      }

      const latest = await input.runObjects.listObjects(input.runId);
      let convertedCount = 0;
      let failedCount = 0;
      let reviewRequiredCount = 0;
      let deferredCount = 0;
      let waitingDependencyCount = 0;
      const issues: string[] = [];
      if (aiProviderError) {
        issues.push(aiProviderError);
      }
      for (const object of latest) {
        if (object.deferred) {
          deferredCount += 1;
          continue;
        }
        if (object.status === "WAITING_DEPENDENCY") {
          waitingDependencyCount += 1;
          continue;
        }
        if (object.status === "VALIDATED") {
          convertedCount += 1;
        } else if (object.status === "FAILED") {
          failedCount += 1;
        } else if (object.status === "REVIEW_REQUIRED") {
          reviewRequiredCount += 1;
        }
        const detail = object.testError ?? object.compileError;
        if (
          (object.status === "FAILED" || object.status === "REVIEW_REQUIRED") &&
          detail &&
          issues.length < 8 &&
          !issues.some((item) => item.includes(detail))
        ) {
          issues.push(`${object.owner}.${object.name}: ${detail}`);
        }
      }

      const finishing = await input.runs.getById(input.runId);
      if (isConversionStopped(finishing)) {
        await input.runs.update(input.runId, {
          status: "CANCELLED",
          errorMessage: "Stopped by user",
          compiledCount,
          compileFailedCount,
          testedCount,
          testFailedCount,
          convertedCount,
          failedCount,
          reviewRequiredCount,
          deferredCount,
          waitingDependencyCount,
          stats: {
            ...(finishing?.stats ?? {}),
            tracks,
            aiFixCount,
            aiVerifyCount,
            ...(aiProviderError ? { aiError: aiProviderError } : {}),
            issues,
            cancelRequested: true,
          },
          finishedAt: new Date(),
        });
        await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
        return;
      }

      await input.runs.update(input.runId, {
        status: "SUCCEEDED",
        compiledCount,
        compileFailedCount,
        testedCount,
        testFailedCount,
        convertedCount,
        failedCount,
        reviewRequiredCount,
        deferredCount,
        waitingDependencyCount,
        stats: {
          ...(run?.stats ?? {}),
          tracks,
          aiFixCount,
          aiVerifyCount,
          ...(aiProviderError ? { aiError: aiProviderError } : {}),
          issues,
        },
        finishedAt: new Date(),
      });
      await input.audit.append({
        projectId: input.projectId,
        action: "validation.completed",
        entityType: "migration_run",
        entityId: input.runId,
        metadata: {
          compiledCount,
          compileFailedCount,
          testedCount,
          testFailedCount,
          aiFixCount,
          aiVerifyCount,
          slot: slot.database,
        },
      });
      await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
    } finally {
      try {
        await target.end();
      } catch {
        // ignore
      }
    }
  } catch (error) {
    const latest = await input.runs.getById(input.runId);
    if (isConversionStopped(latest)) {
      await input.runs.update(input.runId, {
        status: "CANCELLED",
        errorMessage: "Stopped by user",
        finishedAt: new Date(),
      });
      await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
      return;
    }
    const message = error instanceof Error ? error.message : "Validation failed";
    await input.runs.update(input.runId, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.projectId,
      action: "validation.failed",
      entityType: "migration_run",
      entityId: input.runId,
      metadata: { message },
    });
    await enqueueReport(input.env.REDIS_URL, input.projectId, input.runId);
    throw error;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
    await pool.release(slot);
  }
}
