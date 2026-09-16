import { redactErrorMessage } from "@migrator/ai-core";
import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ObjectDependenciesRepository,
} from "@migrator/db";
import { buildObjectDag } from "@migrator/dependency-graph";
import { applyCatalogColumnPatches, convertOracleDdl, convertWithOra2pgCli, detectRiskFlags, ensureTargetSchemaSql, mergeConstraintAlters } from "@migrator/ora2pg";
import { type ReconcileObjectResult, reconcileObject } from "@migrator/postgres";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  defaultScopeInput,
  evaluateScopeCatalog,
  isConversionStopped,
  isDeterministicSchemaType,
  isPlsqlObjectType,
  MAPPING_RULES_VERSION,
  type DiscoveredObjectMetadata,
  type MigrationStrategy,
  type ObjectStatus,
  parseRunTracks,
  type ReconcileAction,
  typesForTracks,
  type ValidationJobData,
} from "@migrator/shared";
import type { Client } from "pg";
import type { AiRuntime } from "../ai/runtime";
import { connectProjectTarget } from "../target-postgres";

export { conversionObjectOrder } from "@migrator/dependency-graph";

export function shouldConvertWithAi(
  action: ReconcileAction | null | undefined,
  useAi: boolean,
  objectType?: string,
): boolean {
  if (!useAi || action === "SKIP_UNCHANGED") {
    return false;
  }
  if (objectType && !isPlsqlObjectType(objectType)) {
    return false;
  }
  return true;
}

function persistFromReconcile(
  recon: ReconcileObjectResult,
  previous: {
    desiredShapeHash: string | null;
    targetShapeHash: string | null;
  },
) {
  return {
    targetState: recon.targetState,
    reconcileAction: recon.reconcileAction,
    previousDesiredShapeHash: previous.desiredShapeHash,
    desiredShapeHash: recon.desiredHash,
    previousTargetShapeHash: previous.targetShapeHash,
    targetShapeHash: recon.targetHash,
    reconcileSql: recon.reconcileSql,
    reconcileDiff: {
      reason: recon.reason,
      destructive: recon.diff.destructive,
      changes: recon.diff.changes,
    },
  };
}

export async function runConversion(input: {
  env: AppEnv;
  cipher: SecretCipher;
  projectId: string;
  runId: string;
  runs: MigrationRunsRepository;
  runObjects: MigrationRunObjectsRepository;
  objects: DiscoveredObjectsRepository;
  scopes: MigrationScopesRepository;
  dependencies: ObjectDependenciesRepository;
  attempts: ConversionAttemptsRepository;
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
  const startedAt = new Date();
  await input.runs.update(input.runId, { status: "RUNNING", startedAt });
  let target: Client | undefined;
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
    target = await connectProjectTarget({
      projectId: input.projectId,
      connections: input.connections,
      cipher: input.cipher,
      statementTimeoutMs: input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
    });
    const strategy = (run?.strategy ?? "FAST") as MigrationStrategy;
    const tracks = parseRunTracks(run?.stats);
    const selectedTypes = typesForTracks(tracks);
    const useAiConvert = tracks.includes("PLSQL") && Boolean(input.ai.convert);
    const catalog = await input.objects.listFingerprints(input.projectId);
    const saved = await input.scopes.getByProjectId(input.projectId);
    const rules = saved
      ? {
          includeSchemas: saved.includeSchemas,
          includeObjectTypes: saved.includeObjectTypes,
          includeNamePatterns: saved.includeNamePatterns,
          excludeNamePatterns: saved.excludeNamePatterns,
          excludeObjects: saved.excludeObjects,
          dataMode: saved.dataMode,
          selectedTables: saved.selectedTables,
        }
      : defaultScopeInput([...new Set(catalog.map((row) => row.owner))]);

    const included = evaluateScopeCatalog(catalog, rules).filter((row) => row.included);
    const snapshot = included.map((row) => ({
      objectId: row.id,
      deferred: !selectedTypes.has(row.objectType),
    }));
    await input.runObjects.replace(input.runId, snapshot);

    const edges = await input.dependencies.listByProject(input.projectId);
    const dag = buildObjectDag({
      nodes: catalog.map((row) => ({
        id: row.id,
        owner: row.owner,
        name: row.name,
        objectType: row.objectType,
      })),
      selectedIds: included.map((row) => row.id),
      unavailableIds: included
        .filter((row) => {
          if (selectedTypes.has(row.objectType)) {
            return false;
          }
          const live = catalog.find((item) => item.id === row.id);
          return !live?.targetSql || live.status === "FAILED";
        })
        .map((row) => row.id),
      edges: edges.map((edge) => ({
        fromId: edge.fromObjectId,
        toId: edge.toObjectId,
        dependencyType: edge.dependencyType,
      })),
    });
    const dagNodeById = new Map(dag.nodes.map((node) => [node.id, node]));

    let convertedCount = 0;
    let failedCount = 0;
    let reviewRequiredCount = 0;
    let deferredCount = 0;
    let waitingDependencyCount = 0;
    let aiConvertCount = 0;

    for (const objectId of dag.order) {
      const latest = await input.runs.getById(input.runId);
      if (isConversionStopped(latest)) {
        await input.runs.update(input.runId, {
          status: "CANCELLED",
          errorMessage: "Stopped by user",
          convertedCount,
          failedCount,
          reviewRequiredCount,
          deferredCount,
          waitingDependencyCount,
          stats: {
            ...(latest?.stats ?? {}),
            tracks,
            mappingRulesVersion: MAPPING_RULES_VERSION,
            strategy,
            aiConvertCount,
            cancelRequested: true,
          },
          finishedAt: new Date(),
        });
        return;
      }
      const object = catalog.find((row) => row.id === objectId);
      if (!object) {
        continue;
      }
      const dagNode = dagNodeById.get(object.id);
      const inTrack = selectedTypes.has(object.objectType);
      if (!inTrack) {
        deferredCount += 1;
        continue;
      }
      if (dagNode?.waiting) {
        waitingDependencyCount += 1;
        await input.objects.updateConversion(object.id, {
          status: "WAITING_DEPENDENCY",
          targetSql: null,
          lastConversionRunId: input.runId,
        });
        continue;
      }
      const started = Date.now();
      const metadata = (object.metadata ?? {}) as DiscoveredObjectMetadata;
      let result = convertOracleDdl({
        objectType: object.objectType,
        owner: object.owner,
        name: object.name,
        sourceText: object.sourceText,
        columns: metadata.columns,
        tableName: metadata.tableName,
      });
      if (
        input.env.ORA2PG_BIN &&
        object.sourceText &&
        object.objectType !== "CONSTRAINT" &&
        object.objectType !== "INDEX"
      ) {
        try {
          const sql = await convertWithOra2pgCli({
            bin: input.env.ORA2PG_BIN,
            sourceText: object.sourceText,
            objectType: object.objectType,
          });
          let nextSql = ensureTargetSchemaSql(sql, object.owner, object.name, object.objectType);
          if (object.objectType === "TABLE") {
            const patched = applyCatalogColumnPatches(
              nextSql,
              object.owner,
              object.name,
              metadata.columns ?? [],
            );
            nextSql = mergeConstraintAlters(patched.sql, result.sql ?? "");
            const catalogWarnings: string[] = [];
            if (patched.rewrittenTypes.length > 0) {
              catalogWarnings.push(
                `Aligned column types with Oracle catalog (${patched.rewrittenTypes.join("; ")})`,
              );
            }
            if (patched.added.length > 0) {
              catalogWarnings.push(
                `Oracle catalog has columns missing from extracted DDL; added ${patched.added.join(", ")}`,
              );
            }
            result = {
              ...result,
              sql: nextSql,
              converterType: "ORA2PG",
              warnings: [...result.warnings, ...catalogWarnings],
            };
          } else {
            result = {
              ...result,
              sql: nextSql,
              converterType: "ORA2PG",
            };
          }
        } catch {
          result = {
            ...result,
            warnings: [...result.warnings, "Ora2Pg CLI failed; used the TypeScript mapping engine"],
          };
        }
      }
      const attemptNumber = await input.attempts.nextAttemptNumber(input.runId, object.id);
      await input.attempts.append({
        runId: input.runId,
        objectId: object.id,
        attemptNumber,
        converterType: result.converterType,
        mappingRulesVersion: result.mappingRulesVersion,
        sourceHash: object.sourceHash,
        generatedSql: result.sql,
        warnings: result.warnings,
        riskFlags: result.riskFlags,
        status: result.status,
        errorMessage: result.errorMessage,
        durationMs: Date.now() - started,
      });

      let recon: ReconcileObjectResult | null = null;
      if (result.sql && target) {
        recon = await reconcileObject({
          executor: target,
          objectType: object.objectType,
          schema: result.targetSchema,
          name: result.targetName,
          desiredSql: result.sql,
          previousDesiredHash: object.desiredShapeHash,
          previousTargetHash: object.targetShapeHash,
          estimatedRowCount: object.estimatedRowCount,
        });
      }

      if (
        shouldConvertWithAi(recon?.reconcileAction, useAiConvert, object.objectType) &&
        input.ai.convert &&
        object.sourceText
      ) {
        await input.objects.updateConversion(object.id, { status: "CONVERTING_AI" });
        const aiStarted = Date.now();
        try {
          const ai = await input.ai.convert.convert({
            objectType: object.objectType,
            owner: object.owner,
            name: object.name,
            sourceText: object.sourceText,
            currentSql: result.sql,
            warnings: result.warnings,
          });
          const aiAttempt = await input.attempts.nextAttemptNumber(input.runId, object.id);
          const riskFlags = [
            ...new Set([...result.riskFlags, ...detectRiskFlags(ai.sql ?? object.sourceText)]),
          ];
          await input.attempts.append({
            runId: input.runId,
            objectId: object.id,
            attemptNumber: aiAttempt,
            converterType: "AI",
            mappingRulesVersion: ai.promptVersion,
            sourceHash: object.sourceHash,
            generatedSql: ai.sql ?? result.sql,
            warnings: [...result.warnings, ...ai.warnings],
            riskFlags,
            status: ai.status,
            errorMessage: ai.notes,
            durationMs: Date.now() - aiStarted,
          });
          aiConvertCount += 1;
          if (ai.sql) {
            result = {
              ...result,
              sql: ai.sql,
              status: ai.status,
              warnings: [...result.warnings, ...ai.warnings],
              riskFlags,
              converterType: "AI",
              mappingRulesVersion: ai.promptVersion,
              errorMessage: ai.notes,
            };
          } else if (ai.status !== "SUCCEEDED") {
            result = {
              ...result,
              status: ai.status,
              warnings: [...result.warnings, ...ai.warnings],
            };
          }
        } catch (error) {
          const aiAttempt = await input.attempts.nextAttemptNumber(input.runId, object.id);
          await input.attempts.append({
            runId: input.runId,
            objectId: object.id,
            attemptNumber: aiAttempt,
            converterType: "AI",
            mappingRulesVersion: "ai-converter",
            sourceHash: object.sourceHash,
            generatedSql: result.sql,
            warnings: result.warnings,
            riskFlags: result.riskFlags,
            status: "FAILED",
            errorMessage: redactErrorMessage(error),
            durationMs: Date.now() - aiStarted,
          });
          aiConvertCount += 1;
        }
        if (result.sql && target) {
          recon = await reconcileObject({
            executor: target,
            objectType: object.objectType,
            schema: result.targetSchema,
            name: result.targetName,
            desiredSql: result.sql,
            previousDesiredHash: object.desiredShapeHash,
            previousTargetHash: object.targetShapeHash,
            estimatedRowCount: object.estimatedRowCount,
          });
        }
      }

      let status: ObjectStatus = "CONVERTING_RULE";
      if (result.status === "FAILED") {
        failedCount += 1;
        status = "FAILED";
      } else if (
        !isDeterministicSchemaType(object.objectType) &&
        (recon?.targetState === "TARGET_DRIFTED" ||
          recon?.targetState === "TARGET_CONFLICT" ||
          result.status === "REVIEW_REQUIRED" ||
          recon?.reconcileAction === "REVIEW_REQUIRED")
      ) {
        reviewRequiredCount += 1;
        status = "REVIEW_REQUIRED";
      } else if (dagNode?.inCycle && !isDeterministicSchemaType(object.objectType)) {
        convertedCount += 1;
        reviewRequiredCount += 1;
        status = "REVIEW_REQUIRED";
      } else {
        convertedCount += 1;
        status = "COMPILING";
      }
      await input.objects.updateConversion(object.id, {
        status,
        targetSchema: result.targetSchema,
        targetName: result.targetName,
        targetSql: result.sql,
        riskLevel: result.riskLevel,
        attemptCount: (await input.attempts.listByRunObject(input.runId, object.id)).length,
        lastConversionRunId: input.runId,
        ...(recon
          ? persistFromReconcile(recon, {
              desiredShapeHash: object.desiredShapeHash,
              targetShapeHash: object.targetShapeHash,
            })
          : {}),
      });
    }

    await input.runs.update(input.runId, {
      objectCount: included.length,
      convertedCount,
      failedCount,
      reviewRequiredCount,
      deferredCount,
      waitingDependencyCount,
      stats: {
        ...(run?.stats ?? {}),
        tracks,
        mappingRulesVersion: MAPPING_RULES_VERSION,
        strategy,
        aiConvertCount,
        dag: {
          layerCount: dag.layers.length,
          cycleCount: dag.cycleCount,
          waitingCount: dag.waitingCount,
        },
      },
    });
    await input.audit.append({
      projectId: input.projectId,
      action: "conversion.completed",
      entityType: "migration_run",
      entityId: input.runId,
      metadata: {
        convertedCount,
        failedCount,
        reviewRequiredCount,
        deferredCount,
        waitingDependencyCount,
        aiConvertCount,
        tracks,
      },
    });

    const afterConvert = await input.runs.getById(input.runId);
    if (isConversionStopped(afterConvert)) {
      await input.runs.update(input.runId, {
        status: "CANCELLED",
        errorMessage: "Stopped by user",
        convertedCount,
        failedCount,
        reviewRequiredCount,
        deferredCount,
        waitingDependencyCount,
        stats: {
          ...(afterConvert?.stats ?? {}),
          tracks,
          mappingRulesVersion: MAPPING_RULES_VERSION,
          strategy,
          aiConvertCount,
          cancelRequested: true,
        },
        finishedAt: new Date(),
      });
      return;
    }

    const queue = createQueue<ValidationJobData>(QUEUE_NAMES.validation, input.env.REDIS_URL);
    try {
      await queue.add(
        "validate",
        { projectId: input.projectId, runId: input.runId },
        { jobId: `validation-${input.runId}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
      );
    } finally {
      await queue.close();
    }
  } catch (error) {
    const latest = await input.runs.getById(input.runId);
    if (isConversionStopped(latest)) {
      await input.runs.update(input.runId, {
        status: "CANCELLED",
        errorMessage: "Stopped by user",
        finishedAt: new Date(),
      });
      return;
    }
    const message = error instanceof Error ? error.message : "Conversion failed";
    await input.runs.update(input.runId, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.projectId,
      action: "conversion.failed",
      entityType: "migration_run",
      entityId: input.runId,
      metadata: { message },
    });
    throw error;
  } finally {
    try {
      await target?.end();
    } catch {
      // ignore
    }
  }
}
