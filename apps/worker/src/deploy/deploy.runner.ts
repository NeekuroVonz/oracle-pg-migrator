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
  createPostgresClient,
  inspectTargetObject,
  postgresConfigFromConnection,
} from "@migrator/postgres";
import { type DeployJobData, hashPgShape } from "@migrator/shared";
import { isDuplicateObjectError, splitSqlStatements } from "@migrator/validator";
import type { Client } from "pg";

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
      });
      return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
    }
    if (
      liveHash &&
      discovered.targetShapeHash &&
      liveHash !== discovered.targetShapeHash &&
      liveHash !== discovered.desiredShapeHash
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
    await applyObjectSql(input.query, input.object.sql);
    await input.discovered.updateConversion(discovered.id, {
      targetState: "TARGET_MATCHED",
      reconcileAction: "SKIP_UNCHANGED",
      previousDesiredShapeHash: discovered.desiredShapeHash,
      previousTargetShapeHash: discovered.targetShapeHash,
      targetShapeHash: discovered.desiredShapeHash,
    });
    return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deploy failed";
    const schema = discovered?.targetSchema ?? schemaFallback;
    const name = discovered?.targetName ?? nameFallback;
    if (isDuplicateObjectError({ message }) && discovered) {
      const live = await inspectTargetObject(input.executor, {
        objectType: input.object.objectType,
        schema,
        name,
      });
      if (live) {
        await input.discovered.updateConversion(discovered.id, {
          targetState: "TARGET_MATCHED",
          reconcileAction: "SKIP_UNCHANGED",
          previousTargetShapeHash: discovered.targetShapeHash,
          targetShapeHash: hashPgShape(live),
        });
        return input.objects.update(input.object.id, { status: "SUCCEEDED", errorMessage: null });
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
