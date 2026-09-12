import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  type ConnectionRow,
  ConnectionsRepository,
  DataCopyRunsRepository,
  type DataCopyTableRow,
  DataCopyTablesRepository,
  type DiscoveredObjectRow,
  MigrationReportsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  TestAttemptsRepository,
  ValidationAttemptsRepository,
} from "@migrator/db";
import { toPgIdent } from "@migrator/ora2pg";
import type { OracleReadOnlyClient } from "@migrator/oracle";
import {
  bulkInsertRows,
  countPostgresTable,
  createPostgresClient,
  type PostgresTargetConfig,
  truncatePostgresTable,
} from "@migrator/postgres";
import {
  type DataCopyJobData,
  type DiscoveredObjectMetadata,
  dataCopyReadiness,
} from "@migrator/shared";
import type { Client } from "pg";
import { oracleClientFromRow } from "../discovery/oracle-from-row";
import { runReport } from "../report/report.runner";

const PG_PARAM_BUDGET = 60_000;

function postgresConfigFromRow(row: ConnectionRow, password: string): PostgresTargetConfig {
  return {
    host: row.host ?? "localhost",
    port: row.port ?? 5432,
    database: row.databaseName ?? "postgres",
    username: row.username,
    password,
    sslMode: row.sslMode ?? "prefer",
    connectionTimeoutMs: row.connectionTimeoutMs,
  };
}

function oracleColumns(row: DiscoveredObjectRow): string[] {
  const metadata = (row.metadata ?? {}) as DiscoveredObjectMetadata;
  const columns = [...(metadata.columns ?? [])].sort(
    (left, right) => (left.columnId ?? 0) - (right.columnId ?? 0),
  );
  return columns.map((column) => column.name);
}

function chunkLimit(requested: number, columnCount: number): number {
  if (columnCount <= 0) {
    return requested;
  }
  return Math.max(1, Math.min(requested, Math.floor(PG_PARAM_BUDGET / columnCount)));
}

async function copyOneTable(input: {
  table: DataCopyTableRow;
  object: DiscoveredObjectRow;
  chunkSize: number;
  oracle: OracleReadOnlyClient;
  postgres: Client;
  tables: DataCopyTablesRepository;
}): Promise<DataCopyTableRow> {
  const columns = oracleColumns(input.object);
  if (columns.length === 0) {
    return input.tables.update(input.table.id, {
      status: "FAILED",
      errorMessage: "No discovered columns for this table",
    });
  }
  const pgColumns = columns.map((column) => toPgIdent(column));
  const limit = chunkLimit(input.chunkSize, columns.length);
  let copied = input.table.copiedRows;
  let offset = input.table.lastOffset;
  try {
    await input.tables.update(input.table.id, { status: "RUNNING", errorMessage: null });
    if (offset === 0) {
      await truncatePostgresTable(input.postgres, input.table.targetSchema, input.table.targetName);
    }
    const oracleRows = await input.oracle.countTableRows(input.table.owner, input.table.name);
    while (offset < oracleRows) {
      const rows = await input.oracle.readTableChunk({
        owner: input.table.owner,
        name: input.table.name,
        columns,
        offset,
        limit,
      });
      if (rows.length === 0) {
        break;
      }
      await bulkInsertRows(
        input.postgres,
        input.table.targetSchema,
        input.table.targetName,
        pgColumns,
        rows,
      );
      copied += rows.length;
      offset += rows.length;
      await input.tables.update(input.table.id, {
        copiedRows: copied,
        lastOffset: offset,
        oracleRows,
      });
      if (rows.length < limit) {
        break;
      }
    }
    const postgresRows = await countPostgresTable(
      input.postgres,
      input.table.targetSchema,
      input.table.targetName,
    );
    return input.tables.update(input.table.id, {
      status: "SUCCEEDED",
      oracleRows,
      postgresRows,
      copiedRows: copied,
      lastOffset: offset,
      errorMessage: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data copy failed";
    return input.tables.update(input.table.id, {
      status: "FAILED",
      copiedRows: copied,
      lastOffset: offset,
      errorMessage: message,
    });
  }
}

export async function runDataCopy(input: {
  env: AppEnv;
  cipher: SecretCipher;
  job: DataCopyJobData;
  connections: ConnectionsRepository;
  copyRuns: DataCopyRunsRepository;
  copyTables: DataCopyTablesRepository;
  runs: MigrationRunsRepository;
  runObjects: MigrationRunObjectsRepository;
  dependencies: ObjectDependenciesRepository;
  validations: ValidationAttemptsRepository;
  tests: TestAttemptsRepository;
  reports: MigrationReportsRepository;
  audit: AuditRepository;
}): Promise<void> {
  const copyRun = await input.copyRuns.getById(input.job.copyRunId);
  if (!copyRun || copyRun.projectId !== input.job.projectId) {
    throw new Error("Data copy run not found");
  }
  const source = await input.connections.getByProjectRole(input.job.projectId, "SOURCE");
  const target = await input.connections.getByProjectRole(input.job.projectId, "TARGET");
  if (source?.engine !== "ORACLE") {
    throw new Error("Oracle source connection is required");
  }
  if (target?.engine !== "POSTGRESQL") {
    throw new Error("PostgreSQL target connection is required");
  }
  const oraclePassword = input.cipher.decrypt(source.passwordCiphertext);
  const postgresPassword = input.cipher.decrypt(target.passwordCiphertext);
  const oracle = oracleClientFromRow(source, oraclePassword, input.env.ORACLE_STATEMENT_TIMEOUT_MS);
  const postgres = createPostgresClient(postgresConfigFromRow(target, postgresPassword));
  await input.copyRuns.update(copyRun.id, { status: "RUNNING", startedAt: new Date() });
  const members = await input.runObjects.listObjects(copyRun.conversionRunId);
  const objects = new Map(members.map((row) => [row.id, row]));
  await postgres.connect();
  try {
    const tables = await input.copyTables.listByCopyRun(copyRun.id);
    for (const table of tables) {
      if (table.status === "SUCCEEDED") {
        continue;
      }
      const object = objects.get(table.objectId);
      if (!object) {
        await input.copyTables.update(table.id, {
          status: "FAILED",
          errorMessage: "Table is not in this conversion run",
        });
        continue;
      }
      await copyOneTable({
        table,
        object,
        chunkSize: copyRun.chunkSize,
        oracle,
        postgres,
        tables: input.copyTables,
      });
    }
    const finalTables = await input.copyTables.listByCopyRun(copyRun.id);
    const copiedCount = finalTables.filter((row) => row.status === "SUCCEEDED").length;
    const failedCount = finalTables.filter((row) => row.status === "FAILED").length;
    const matched = dataCopyReadiness(finalTables);
    await input.copyRuns.update(copyRun.id, {
      status: failedCount > 0 ? "FAILED" : "SUCCEEDED",
      copiedCount,
      failedCount,
      matchedCount: matched.passed,
      errorMessage: failedCount > 0 ? `${failedCount} table(s) failed to copy` : null,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.job.projectId,
      action: failedCount > 0 ? "data-copy.failed" : "data-copy.completed",
      entityType: "data_copy_run",
      entityId: copyRun.id,
      metadata: {
        conversionRunId: copyRun.conversionRunId,
        copiedCount,
        failedCount,
        matchedCount: matched.passed,
      },
    });
    await runReport({
      projectId: input.job.projectId,
      runId: copyRun.conversionRunId,
      runs: input.runs,
      runObjects: input.runObjects,
      dependencies: input.dependencies,
      validations: input.validations,
      tests: input.tests,
      reports: input.reports,
      audit: input.audit,
      dataPassed: matched.passed,
      dataTotal: matched.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Data copy failed";
    await input.copyRuns.update(copyRun.id, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.job.projectId,
      action: "data-copy.failed",
      entityType: "data_copy_run",
      entityId: copyRun.id,
      metadata: { conversionRunId: copyRun.conversionRunId, message },
    });
    throw error;
  } finally {
    await postgres.end();
  }
}
