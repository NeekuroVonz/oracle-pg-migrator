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
import { inspectTargetObject, reconcileObject, sandboxSqlForAction } from "@migrator/postgres";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import type {
  DiscoveredObjectMetadata,
  MigrationStrategy,
  ObjectStatus,
  ReportingJobData,
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

const SKIPPED_COMPILE: CompileResult = {
  ok: true,
  statements: 0,
  durationMs: 0,
  errorCode: null,
  errorMessage: null,
  diagnostics: [],
};

async function persistSkipped(input: {
  runId: string;
  object: RunObject;
  sql: string;
  objects: DiscoveredObjectsRepository;
  validations: ValidationAttemptsRepository;
}): Promise<void> {
  await persistCompile({
    runId: input.runId,
    object: input.object,
    sql: input.sql,
    compiled: SKIPPED_COMPILE,
    status: "VALIDATED",
    objects: input.objects,
    validations: input.validations,
  });
  await input.objects.updateConversion(input.object.id, {
    status: "VALIDATED",
    compileStatus: "SKIPPED",
    compileError: null,
    testStatus: "SKIPPED",
    testError: null,
  });
  input.object.status = "VALIDATED";
  input.object.compileStatus = "SKIPPED";
  input.object.testStatus = "SKIPPED";
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
      const strategy = (run?.strategy ?? "FAST") as MigrationStrategy;
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

          if (
            recon.reconcileAction === "SKIP_UNCHANGED" ||
            recon.targetState === "TARGET_MATCHED"
          ) {
            compiledCount += 1;
            await persistSkipped({
              runId: input.runId,
              object,
              sql,
              objects: input.objects,
              validations: input.validations,
            });
            continue;
          }

          if (
            recon.reconcileAction === "REVIEW_REQUIRED" ||
            recon.targetState === "TARGET_DRIFTED" ||
            recon.targetState === "TARGET_CONFLICT"
          ) {
            await input.objects.updateConversion(object.id, {
              status: "REVIEW_REQUIRED",
              compileStatus: null,
              compileError: recon.reason,
            });
            object.status = "REVIEW_REQUIRED";
            continue;
          }

          const sandboxSql = sandboxSqlForAction({
            action: recon.reconcileAction,
            desiredSql: sql,
            reconcileSql: recon.reconcileSql,
            cloneSql: recon.cloneSql,
          });
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
              ignoreDuplicateObjects: recon.reconcileAction !== "CREATE_REQUIRED",
            },
          );
          if (!compiled.ok && isDuplicateObjectError(compiled)) {
            const live =
              recon.actual ??
              (await inspectTargetObject(target, {
                objectType: object.objectType,
                schema: object.targetSchema ?? "",
                name: object.targetName ?? "",
              }));
            if (live) {
              const again = await reconcileObject({
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
                targetState: again.targetState,
                reconcileAction: again.reconcileAction,
                desiredShapeHash: again.desiredHash,
                targetShapeHash: again.targetHash,
                reconcileSql: again.reconcileSql,
                reconcileDiff: {
                  reason: again.reason,
                  destructive: again.diff.destructive,
                  changes: again.diff.changes,
                },
              });
              object.reconcileAction = again.reconcileAction;
              object.targetState = again.targetState;
              object.reconcileSql = again.reconcileSql;
              object.desiredShapeHash = again.desiredHash;
              object.targetShapeHash = again.targetHash;
              if (
                again.reconcileAction === "SKIP_UNCHANGED" ||
                again.targetState === "TARGET_MATCHED" ||
                again.reconcileAction === "CREATE_REQUIRED"
              ) {
                compiledCount += 1;
                await persistSkipped({
                  runId: input.runId,
                  object,
                  sql,
                  objects: input.objects,
                  validations: input.validations,
                });
                continue;
              }
              if (
                again.reconcileAction === "REVIEW_REQUIRED" ||
                again.targetState === "TARGET_DRIFTED" ||
                again.targetState === "TARGET_CONFLICT"
              ) {
                await input.objects.updateConversion(object.id, {
                  status: "REVIEW_REQUIRED",
                  compileStatus: null,
                  compileError: again.reason,
                });
                object.status = "REVIEW_REQUIRED";
                continue;
              }
              const retrySql = sandboxSqlForAction({
                action: again.reconcileAction,
                desiredSql: sql,
                reconcileSql: again.reconcileSql,
                cloneSql: again.cloneSql,
              });
              if (!retrySql) {
                await input.objects.updateConversion(object.id, {
                  status: "REVIEW_REQUIRED",
                  compileError: again.reason,
                });
                object.status = "REVIEW_REQUIRED";
                continue;
              }
              compiled = await compileSql(
                client,
                retrySql,
                input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
                { ignoreDuplicateObjects: true },
              );
            } else {
              compiled = {
                ...compiled,
                ok: true,
                errorCode: null,
                errorMessage: null,
                diagnostics: [],
              };
            }
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
                highRisk: object.riskLevel === "HIGH",
                reviewRequired: object.status === "REVIEW_REQUIRED",
              })
            : recon.reconcileAction === "UPDATE_REQUIRED" ||
                recon.reconcileAction === "REPLACE_REQUIRED"
              ? "REVIEW_REQUIRED"
              : objectStatusAfterCompile({
                  compilePassed: false,
                  highRisk: object.riskLevel === "HIGH",
                  reviewRequired: object.status === "REVIEW_REQUIRED",
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

      if (input.ai.fix) {
        const fixer = input.ai.fix;
        const failed = compilable.filter(
          (row) =>
            row.compileStatus === "FAILED" &&
            row.targetSql &&
            row.reconcileAction === "CREATE_REQUIRED" &&
            !isDuplicateObjectError({ errorMessage: row.compileError }),
        );
        for (const object of failed) {
          if (aiProviderError) {
            break;
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
        const reviewRequired = object.riskLevel === "HIGH" || object.status === "REVIEW_REQUIRED";
        await input.objects.updateConversion(object.id, { status: "TESTING" });
        const metadata = (object.metadata ?? {}) as DiscoveredObjectMetadata;
        const tests = await runStructuralTests(client, {
          objectType: object.objectType,
          targetSchema: object.targetSchema,
          targetName: object.targetName,
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
          highRisk: object.riskLevel === "HIGH",
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
      const shouldVerify =
        Boolean(verifier) && (strategy === "BALANCED" || strategy === "MAXIMUM_ACCURACY");
      if (shouldVerify && verifier) {
        const targets = compilable.filter((row) => {
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
