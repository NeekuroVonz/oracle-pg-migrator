import { Client } from "pg";
import { type PostgresTargetConfig, postgresSslOption } from "./connection-test";
import { applySqlDroppingDependentViews } from "./dependent-views";

export function createPostgresClient(
  config: PostgresTargetConfig,
  statementTimeoutMs = 120_000,
): Client {
  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: postgresSslOption(config.sslMode),
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: statementTimeoutMs,
  });
}

export function quotePgIdent(raw: string): string {
  const unquoted = raw.replace(/^"/, "").replace(/"$/, "").replaceAll('""', '"');
  if (/^[A-Z][A-Z0-9_]*$/.test(unquoted)) {
    return unquoted.toLowerCase();
  }
  if (/^[a-z_][a-z0-9_]*$/.test(unquoted)) {
    return unquoted;
  }
  return `"${unquoted.replaceAll('"', '""')}"`;
}

export function qualifiedTable(schema: string, table: string): string {
  return `${quotePgIdent(schema)}.${quotePgIdent(table)}`;
}

export function buildBulkInsertSql(
  schema: string,
  table: string,
  columns: string[],
  rowCount: number,
): string {
  const qualified = qualifiedTable(schema, table);
  const cols = columns.map((column) => quotePgIdent(column)).join(", ");
  const values = Array.from({ length: rowCount }, (_, rowIndex) => {
    const start = rowIndex * columns.length + 1;
    const placeholders = columns.map((_, columnIndex) => `$${start + columnIndex}`);
    return `(${placeholders.join(", ")})`;
  });
  return `INSERT INTO ${qualified} (${cols}) VALUES ${values.join(", ")}`;
}

export async function bulkInsertRows(
  client: Client,
  schema: string,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  const sql = buildBulkInsertSql(schema, table, columns, rows.length);
  const values = rows.flatMap((row) => row.map((cell) => (cell === undefined ? null : cell)));
  await client.query(sql, values);
  return rows.length;
}

export async function countPostgresTable(
  client: Client,
  schema: string,
  table: string,
): Promise<number> {
  const result = await client.query<{ n: string }>(
    `SELECT COUNT(*)::bigint AS n FROM ${qualifiedTable(schema, table)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function truncatePostgresTable(
  client: Client,
  schema: string,
  table: string,
): Promise<void> {
  await client.query(`TRUNCATE TABLE ${qualifiedTable(schema, table)}`);
}

/**
 * Widen smallint/integer/bigint → numeric so Oracle NUMBER fractional values can load.
 * Safe before/after TRUNCATE; used when TARGET was deployed with the old integer mapping.
 */
export async function widenIntegerColumnsToNumeric(
  client: Client,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
       AND data_type IN ('smallint', 'integer', 'bigint')
     ORDER BY ordinal_position`,
    [schema, table],
  );
  const altered: string[] = [];
  const statements: string[] = [];
  for (const row of result.rows) {
    const col = quotePgIdent(row.column_name);
    const qualified = qualifiedTable(schema, table);
    statements.push(
      `ALTER TABLE ${qualified} ALTER COLUMN ${col} TYPE numeric USING ${col}::numeric`,
    );
    altered.push(row.column_name);
  }
  if (statements.length > 0) {
    await applySqlDroppingDependentViews(client, schema, table, `${statements.join(";\n")};`, (sql) =>
      client.query(sql),
    );
  }
  return altered;
}
