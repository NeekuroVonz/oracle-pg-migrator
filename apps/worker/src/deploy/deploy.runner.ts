import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  type DeployObjectRow,
  DeployObjectsRepository,
  DeployRunsRepository,
  DiscoveredObjectsRepository,
} from "@migrator/db";
import {
  applySqlDroppingDependentViews,
  createPostgresClient,
  inspectTargetObject,
  postgresConfigFromConnection,
  reconcileObject,
} from "@migrator/postgres";
import { aliasViewSelectToColumnList } from "@migrator/ora2pg";
import { type DeployJobData, hashPgShape } from "@migrator/shared";
import { isDuplicateObjectError, splitSqlStatements } from "@migrator/validator";
import type { Client } from "pg";

function isCreateTableSql(sql: string): boolean {
  return /\bCREATE\s+(?:UNLOGGED\s+)?(?:TEMPORARY\s+|TEMP\s+)?TABLE\b/i.test(sql);
}

function isCreateOrReplaceViewSql(sql: string): boolean {
  return /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\b/i.test(sql);
}

function isViewColumnRenameError(message: string): boolean {
  return /cannot change name of view column/i.test(message);
}

function isAlterColumnTypeBlockedByView(message: string): boolean {
  return /cannot alter type of a column used by a view or rule/i.test(message);
}

function toDropCreateViewSql(sql: string, schema: string, name: string): string {
  const qualified = `${quoteSearchPathIdent(schema)}.${quoteSearchPathIdent(name)}`;
  const body = sql
    .replace(/^\s*CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS[^;]+;\s*/gi, "")
    .replace(/\bCREATE\s+OR\s+REPLACE\s+VIEW\b/i, "CREATE VIEW")
    .trim();
  return `DROP VIEW IF EXISTS ${qualified} CASCADE;\n${body.endsWith(";") ? body : `${body};`}`;
}

export async function applyObjectSql(
  query: (sql: string) => Promise<unknown>,
  sql: string,
): Promise<number> {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    throw new Error("No SQL to deploy");
  }
  for (const statement of statements) {
    await query(statement);
  }
  return statements.length;
}

export function quoteSearchPathIdent(value: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** PK already created by TABLE DDL; separate CONSTRAINT deploy is redundant. */
export function isBenignConstraintPrimaryKeyDuplicate(input: {
  objectType: string;
  message: string;
  code?: string | null;
}): boolean {
  if (String(input.objectType).toUpperCase() !== "CONSTRAINT") {
    return false;
  }
  return input.code === "42P16" || /multiple primary keys/i.test(input.message);
}

/** Live object is present; skip overwrite only when it already matches desired (or no desired hash). */
export function shouldAcceptLiveObjectWithoutOverwrite(input: {
  objectType: string;
  reconcileAction: string | null | undefined;
  liveExists: boolean;
  liveHash?: string | null;
  desiredShapeHash?: string | null;
}): boolean {
  if (!input.liveExists) {
    return false;
  }
  if (
    input.reconcileAction === "UPDATE_REQUIRED" ||
    input.reconcileAction === "REPLACE_REQUIRED"
  ) {
    return false;
  }
  // Stale SKIP after mapping change: live bigint vs desired numeric must not be treated as matched.
  if (
    input.desiredShapeHash &&
    input.liveHash &&
    input.liveHash !== input.desiredShapeHash
  ) {
    return false;
  }
  return true;
}

export function isReplaceableViewType(objectType: string): boolean {
  const type = String(objectType).toUpperCase();
  return type === "VIEW" || type === "MATERIALIZED_VIEW";
}

/** Refuse only unexpected TABLE/SEQUENCE drift — never block VIEW replace or planned updates. */
export function shouldRefuseAsTargetDrift(input: {
  objectType: string;
  reconcileAction: string | null | undefined;
  liveHash: string | null | undefined;
  targetShapeHash: string | null | undefined;
  desiredShapeHash: string | null | undefined;
}): boolean {
  if (!input.liveHash || !input.targetShapeHash) {
    return false;
  }
  if (input.liveHash === input.targetShapeHash || input.liveHash === input.desiredShapeHash) {
    return false;
  }
  if (
    input.reconcileAction === "SKIP_UNCHANGED" ||
    input.reconcileAction === "UPDATE_REQUIRED" ||
    input.reconcileAction === "REPLACE_REQUIRED" ||
    input.reconcileAction === "CREATE_REQUIRED"
  ) {
    return false;
  }
  // Views are CREATE OR REPLACE — hash churn is normal after prior partial deploys.
  if (isReplaceableViewType(input.objectType)) {
    return false;
  }
  return true;
}

async function deployOneObject(input: {
  object: DeployObjectRow;
  query: (sql: string) => Promise<unknown>;
  executor: Client;
  objects: DeployObjectsRepository;
  discovered: DiscoveredObjectsRepository;
}): Promise<DeployObjectRow> {
  if (input.object.status === "SUCCEEDED") {
    return input.object;
  }
  let discovered: Awaited<ReturnType<DiscoveredObjectsRepository["getByIdOrThrow"]>> | undefined;
  const schemaFallback = input.object.targetSchema ?? "";
  const nameFallback = input.object.targetName ?? "";
  try {
    await input.objects.update(input.object.id, { status: "RUNNING", errorMessage: null });
    discovered = await input.discovered.getByIdOrThrow(input.object.objectId);
    const schema = discovered.targetSchema ?? schemaFallback;
    const name = discovered.targetName ?? nameFallback;
    const live = await inspectTargetObject(input.executor, {
      objectType: input.object.objectType,
      schema,
      name,
    });
    const liveHash = hashPgShape(live);
    if (liveHash && discovered.desiredShapeHash && liveHash === discovered.desiredShapeHash) {
      await input.discovered.updateConversion(discovered.id, {
        targetState: "TARGET_MATCHED",
        reconcileAction: "SKIP_UNCHANGED",
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: liveHash,
        reconcileSql: null,
      });
      return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
    }

    let sqlToApply = input.object.sql;
    let reconcileAction = discovered.reconcileAction;
    // Always re-reconcile live TABLEs so we ALTER (or SKIP) instead of replaying CREATE.
    if (live && discovered.targetSql && String(input.object.objectType).toUpperCase() === "TABLE") {
      const recon = await reconcileObject({
        executor: input.executor,
        objectType: input.object.objectType,
        schema,
        name,
        desiredSql: discovered.targetSql,
        previousDesiredHash: discovered.desiredShapeHash,
        previousTargetHash: discovered.targetShapeHash,
        estimatedRowCount: discovered.estimatedRowCount,
      });
      reconcileAction = recon.reconcileAction;
      await input.discovered.updateConversion(discovered.id, {
        targetState: recon.targetState,
        reconcileAction: recon.reconcileAction,
        previousDesiredShapeHash: discovered.desiredShapeHash,
        desiredShapeHash: recon.desiredHash,
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: recon.targetHash,
        reconcileSql: recon.reconcileSql,
        reconcileDiff: {
          reason: recon.reason,
          destructive: recon.diff.destructive,
          changes: recon.diff.changes,
        },
      });
      if (recon.reconcileAction === "SKIP_UNCHANGED") {
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
      }
      if (recon.reconcileAction === "REVIEW_REQUIRED") {
        return input.objects.update(input.object.id, {
          status: "FAILED",
          errorMessage: recon.reason || "Reconcile requires review before deploy",
        });
      }
      if (recon.reconcileSql) {
        sqlToApply = recon.reconcileSql;
      } else if (isCreateTableSql(sqlToApply)) {
        // Live table exists; never replay CREATE — treat cosmetic drift as success.
        await input.discovered.updateConversion(discovered.id, {
          targetState: "TARGET_MATCHED",
          reconcileAction: "SKIP_UNCHANGED",
          previousTargetShapeHash: discovered.targetShapeHash,
          targetShapeHash: recon.desiredHash ?? liveHash,
          reconcileSql: null,
        });
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
      }
    } else if (
      live &&
      discovered.targetSql &&
      discovered.desiredShapeHash &&
      liveHash &&
      liveHash !== discovered.desiredShapeHash
    ) {
      const recon = await reconcileObject({
        executor: input.executor,
        objectType: input.object.objectType,
        schema,
        name,
        desiredSql: discovered.targetSql,
        previousDesiredHash: discovered.desiredShapeHash,
        previousTargetHash: discovered.targetShapeHash,
        estimatedRowCount: discovered.estimatedRowCount,
      });
      reconcileAction = recon.reconcileAction;
      await input.discovered.updateConversion(discovered.id, {
        targetState: recon.targetState,
        reconcileAction: recon.reconcileAction,
        previousDesiredShapeHash: discovered.desiredShapeHash,
        desiredShapeHash: recon.desiredHash,
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: recon.targetHash,
        reconcileSql: recon.reconcileSql,
        reconcileDiff: {
          reason: recon.reason,
          destructive: recon.diff.destructive,
          changes: recon.diff.changes,
        },
      });
      if (recon.reconcileAction === "SKIP_UNCHANGED") {
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
      }
      if (
        (recon.reconcileAction === "UPDATE_REQUIRED" ||
          recon.reconcileAction === "REPLACE_REQUIRED" ||
          recon.reconcileAction === "CREATE_REQUIRED") &&
        recon.reconcileSql
      ) {
        sqlToApply = recon.reconcileSql;
      } else if (recon.reconcileAction === "REVIEW_REQUIRED") {
        return input.objects.update(input.object.id, {
          status: "FAILED",
          errorMessage: recon.reason || "Reconcile requires review before deploy",
        });
      }
    }

    // Never CREATE TABLE when it already exists on TARGET.
    if (live && isCreateTableSql(sqlToApply) && String(input.object.objectType).toUpperCase() === "TABLE") {
      await input.discovered.updateConversion(discovered.id, {
        targetState: "TARGET_MATCHED",
        reconcileAction: "SKIP_UNCHANGED",
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: liveHash ?? discovered.targetShapeHash,
        reconcileSql: null,
      });
      return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
    }

    const wantsOverwrite =
      reconcileAction === "UPDATE_REQUIRED" ||
      reconcileAction === "REPLACE_REQUIRED" ||
      (isReplaceableViewType(input.object.objectType) &&
        Boolean(live) &&
        Boolean(sqlToApply) &&
        liveHash !== discovered.desiredShapeHash);
    // Ensure-exists path: object already on TARGET and matches desired (or no desired hash).
    if (
      !wantsOverwrite &&
      shouldAcceptLiveObjectWithoutOverwrite({
        objectType: input.object.objectType,
        reconcileAction,
        liveExists: Boolean(live),
        liveHash,
        desiredShapeHash: discovered.desiredShapeHash,
      })
    ) {
      await input.discovered.updateConversion(discovered.id, {
        targetState: "TARGET_MATCHED",
        reconcileAction: "SKIP_UNCHANGED",
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: liveHash ?? discovered.targetShapeHash,
        reconcileSql: null,
      });
      return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
    }
    if (
      shouldRefuseAsTargetDrift({
        objectType: input.object.objectType,
        reconcileAction,
        liveHash,
        targetShapeHash: discovered.targetShapeHash,
        desiredShapeHash: discovered.desiredShapeHash,
      })
    ) {
      await input.discovered.updateConversion(discovered.id, {
        targetState: "TARGET_DRIFTED",
        reconcileAction: "REVIEW_REQUIRED",
        previousTargetShapeHash: discovered.targetShapeHash,
        targetShapeHash: liveHash,
      });
      return input.objects.update(input.object.id, {
        status: "FAILED",
        errorMessage: "PostgreSQL target drifted since validation; refusing to overwrite",
      });
    }
    if (schema) {
      await input.query(`SET search_path TO ${quoteSearchPathIdent(schema)}, public`);
    }
    // CREATE OR REPLACE VIEW cannot rename columns — DROP then CREATE when replacing.
    if (
      isReplaceableViewType(input.object.objectType) &&
      isCreateOrReplaceViewSql(sqlToApply)
    ) {
      // Prefer SELECT ... AS col from Oracle column list (avoids duplicate pk/coalesce names).
      const schemaStripped = sqlToApply.replace(
        /^\s*CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS[^;]+;\s*/i,
        "",
      );
      const aliased = aliasViewSelectToColumnList(schemaStripped);
      sqlToApply = live
        ? toDropCreateViewSql(
            sqlToApply.includes("CREATE SCHEMA")
              ? `CREATE SCHEMA IF NOT EXISTS ${quoteSearchPathIdent(schema)};\n${aliased}`
              : aliased,
            schema,
            name,
          )
        : `CREATE SCHEMA IF NOT EXISTS ${quoteSearchPathIdent(schema)};\n${aliased}`;
    }
    const apply = async (sql: string) => applyObjectSql(input.query, sql);
    if (
      String(input.object.objectType).toUpperCase() === "TABLE" &&
      /\bALTER\s+TABLE\b/i.test(sqlToApply) &&
      /\bTYPE\b/i.test(sqlToApply)
    ) {
      await applySqlDroppingDependentViews(input.executor, schema, name, sqlToApply, apply);
    } else {
      await apply(sqlToApply);
    }
    await input.discovered.updateConversion(discovered.id, {
      targetState: "TARGET_MATCHED",
      reconcileAction: "SKIP_UNCHANGED",
      previousDesiredShapeHash: discovered.desiredShapeHash,
      previousTargetShapeHash: discovered.targetShapeHash,
      targetShapeHash: discovered.desiredShapeHash,
      reconcileSql: null,
    });
    return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deploy failed";
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : null;
    const schema = discovered?.targetSchema ?? schemaFallback;
    const name = discovered?.targetName ?? nameFallback;
    if (isDuplicateObjectError({ message, code }) && discovered) {
      // Relation exists: re-reconcile and ALTER, or accept as matched.
      try {
        if (discovered.targetSql && String(input.object.objectType).toUpperCase() === "TABLE") {
          const recon = await reconcileObject({
            executor: input.executor,
            objectType: input.object.objectType,
            schema,
            name,
            desiredSql: discovered.targetSql,
            previousDesiredHash: discovered.desiredShapeHash,
            previousTargetHash: discovered.targetShapeHash,
            estimatedRowCount: discovered.estimatedRowCount,
          });
          await input.discovered.updateConversion(discovered.id, {
            targetState: recon.targetState,
            reconcileAction: recon.reconcileAction,
            previousDesiredShapeHash: discovered.desiredShapeHash,
            desiredShapeHash: recon.desiredHash,
            previousTargetShapeHash: discovered.targetShapeHash,
            targetShapeHash: recon.targetHash,
            reconcileSql: recon.reconcileSql,
            reconcileDiff: {
              reason: recon.reason,
              destructive: recon.diff.destructive,
              changes: recon.diff.changes,
            },
          });
          if (recon.reconcileAction === "SKIP_UNCHANGED" || !recon.reconcileSql) {
            await input.discovered.updateConversion(discovered.id, {
              targetState: "TARGET_MATCHED",
              reconcileAction: "SKIP_UNCHANGED",
              targetShapeHash: recon.desiredHash ?? recon.targetHash,
              reconcileSql: null,
            });
            return input.objects.update(input.object.id, {
              status: "SUCCEEDED",
              errorMessage: null,
            });
          }
          if (recon.reconcileAction === "UPDATE_REQUIRED" && recon.reconcileSql) {
            if (schema) {
              await input.query(`SET search_path TO ${quoteSearchPathIdent(schema)}, public`);
            }
            await applySqlDroppingDependentViews(
              input.executor,
              schema,
              name,
              recon.reconcileSql,
              async (sql) => applyObjectSql(input.query, sql),
            );
            await input.discovered.updateConversion(discovered.id, {
              targetState: "TARGET_MATCHED",
              reconcileAction: "SKIP_UNCHANGED",
              targetShapeHash: recon.desiredHash,
              reconcileSql: null,
            });
            return input.objects.update(input.object.id, {
              status: "SUCCEEDED",
              errorMessage: null,
            });
          }
        }
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : "Deploy retry after duplicate failed";
        return input.objects.update(input.object.id, {
          status: "FAILED",
          errorMessage: retryMessage,
        });
      }
      if (
        isBenignConstraintPrimaryKeyDuplicate({
          objectType: input.object.objectType,
          message,
          code,
        })
      ) {
        await input.discovered.updateConversion(discovered.id, {
          targetState: "TARGET_MATCHED",
          reconcileAction: "SKIP_UNCHANGED",
          previousTargetShapeHash: discovered.targetShapeHash,
          targetShapeHash: discovered.desiredShapeHash ?? discovered.targetShapeHash,
          reconcileSql: null,
        });
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
      }
    }
    if (isViewColumnRenameError(message) && discovered && schema && name) {
      try {
        const rebuilt = toDropCreateViewSql(discovered.targetSql ?? input.object.sql, schema, name);
        if (schema) {
          await input.query(`SET search_path TO ${quoteSearchPathIdent(schema)}, public`);
        }
        await applyObjectSql(input.query, rebuilt);
        await input.discovered.updateConversion(discovered.id, {
          targetState: "TARGET_MATCHED",
          reconcileAction: "SKIP_UNCHANGED",
          targetShapeHash: discovered.desiredShapeHash,
          reconcileSql: null,
        });
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
      } catch (viewError) {
        const viewMessage =
          viewError instanceof Error ? viewError.message : "VIEW drop/create failed";
        return input.objects.update(input.object.id, {
          status: "FAILED",
          errorMessage: viewMessage,
        });
      }
    }
    if (isAlterColumnTypeBlockedByView(message) && discovered) {
      try {
        const sql = discovered.reconcileSql ?? input.object.sql;
        if (sql && schema && name) {
          await applySqlDroppingDependentViews(
            input.executor,
            schema,
            name,
            sql,
            async (statement) => applyObjectSql(input.query, statement),
          );
          await input.discovered.updateConversion(discovered.id, {
            targetState: "TARGET_MATCHED",
            reconcileAction: "SKIP_UNCHANGED",
            targetShapeHash: discovered.desiredShapeHash,
            reconcileSql: null,
          });
          return input.objects.update(input.object.id, {
            status: "SUCCEEDED",
            errorMessage: null,
          });
        }
      } catch (viewError) {
        const viewMessage =
          viewError instanceof Error ? viewError.message : "ALTER with dependent views failed";
        return input.objects.update(input.object.id, {
          status: "FAILED",
          errorMessage: viewMessage,
        });
      }
    }
    return input.objects.update(input.object.id, { status: "FAILED", errorMessage: message });
  }
}

export async function runDeploy(input: {
  env: AppEnv;
  cipher: SecretCipher;
  job: DeployJobData;
  connections: ConnectionsRepository;
  deployRuns: DeployRunsRepository;
  deployObjects: DeployObjectsRepository;
  discovered: DiscoveredObjectsRepository;
  audit: AuditRepository;
}): Promise<void> {
  const deployRun = await input.deployRuns.getById(input.job.deployRunId);
  if (!deployRun || deployRun.projectId !== input.job.projectId) {
    throw new Error("Deploy run not found");
  }
  const target = await input.connections.getByProjectRole(input.job.projectId, "TARGET");
  if (target?.engine !== "POSTGRESQL") {
    throw new Error("PostgreSQL target connection is required");
  }
  const password = input.cipher.decrypt(target.passwordCiphertext);
  const postgres = createPostgresClient(
    postgresConfigFromConnection({
      host: target.host,
      port: target.port,
      databaseName: target.databaseName,
      username: target.username,
      password,
      sslMode: target.sslMode,
      connectionTimeoutMs: target.connectionTimeoutMs,
    }),
    input.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
  );
  await input.deployRuns.update(deployRun.id, { status: "RUNNING", startedAt: new Date() });
  await postgres.connect();
  try {
    const objects = await input.deployObjects.listByDeployRun(deployRun.id);
    for (const object of objects) {
      await deployOneObject({
        object,
        query: (sql) => postgres.query(sql),
        executor: postgres,
        objects: input.deployObjects,
        discovered: input.discovered,
      });
    }
    const finalObjects = await input.deployObjects.listByDeployRun(deployRun.id);
    const deployedCount = finalObjects.filter((row) => row.status === "SUCCEEDED").length;
    const failedCount = finalObjects.filter((row) => row.status === "FAILED").length;
    await input.deployRuns.update(deployRun.id, {
      status: failedCount > 0 ? "FAILED" : "SUCCEEDED",
      deployedCount,
      failedCount,
      errorMessage: failedCount > 0 ? `${failedCount} object(s) failed to deploy` : null,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.job.projectId,
      action: failedCount > 0 ? "deploy.failed" : "deploy.completed",
      entityType: "deploy_run",
      entityId: deployRun.id,
      metadata: {
        conversionRunId: deployRun.conversionRunId,
        deployedCount,
        failedCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deploy failed";
    await input.deployRuns.update(deployRun.id, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.job.projectId,
      action: "deploy.failed",
      entityType: "deploy_run",
      entityId: deployRun.id,
      metadata: { conversionRunId: deployRun.conversionRunId, message },
    });
    throw error;
  } finally {
    await postgres.end();
  }
}
