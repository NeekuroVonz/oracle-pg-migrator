import type { ConnectionTestResult, PgSslMode } from "@migrator/shared";
import { Client } from "pg";

export interface PostgresTargetConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: PgSslMode;
  connectionTimeoutMs: number;
}

export function postgresSslOption(
  mode: PgSslMode,
): boolean | { rejectUnauthorized: boolean } | undefined {
  switch (mode) {
    case "disable":
      return false;
    case "prefer":
      return undefined;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-ca":
    case "verify-full":
      return { rejectUnauthorized: true };
    default: {
      const exhaustive: never = mode;
      throw new Error(`unsupported ssl mode: ${String(exhaustive)}`);
    }
  }
}

export async function testPostgresConnection(
  config: PostgresTargetConfig,
): Promise<ConnectionTestResult> {
  const started = Date.now();
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: postgresSslOption(config.sslMode),
    connectionTimeoutMillis: config.connectionTimeoutMs,
    statement_timeout: 10_000,
  });
  try {
    await client.connect();
    try {
      const result = await client.query<{ version: string }>("SELECT version()");
      return {
        ok: true,
        engine: "POSTGRESQL",
        serverVersion: result.rows[0]?.version ?? "PostgreSQL",
        latencyMs: Date.now() - started,
        message: "PostgreSQL connection succeeded. Deploy of validated SQL is an explicit action.",
      };
    } finally {
      await client.end();
    }
  } catch (error) {
    try {
      await client.end();
    } catch {
      // Connection may never have opened.
    }
    return {
      ok: false,
      engine: "POSTGRESQL",
      serverVersion: null,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : "PostgreSQL connection failed",
    };
  }
}
