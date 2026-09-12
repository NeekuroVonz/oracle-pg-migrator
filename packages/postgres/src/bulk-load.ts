import { Client } from "pg";
import { type PostgresTargetConfig, postgresSslOption } from "./connection-test";

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
