import type { DiscoveredColumn, OracleObjectType, TestAttemptStatus } from "@migrator/shared";

export interface CatalogExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface StructuralTestInput {
  objectType: OracleObjectType | string;
  targetSchema: string | null;
  targetName: string | null;
  oracleColumns?: DiscoveredColumn[];
  statementTimeoutMs?: number;
}

export interface StructuralCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface StructuralTestResult {
  ok: boolean;
  skipped: boolean;
  status: TestAttemptStatus;
  errorCode: string | null;
  errorMessage: string | null;
  checks: StructuralCheck[];
  durationMs: number;
}

export function catalogName(ident: string): string {
  const trimmed = ident.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed.toLowerCase();
}

export function quoteIdent(ident: string): string {
  return `"${catalogName(ident).replace(/"/g, '""')}"`;
}

async function firstRow<T extends Record<string, unknown>>(
  executor: CatalogExecutor,
  sql: string,
  values: unknown[],
): Promise<T | undefined> {
  const result = await executor.query<T>(sql, values);
  return result.rows[0];
}

async function allRows<T extends Record<string, unknown>>(
  executor: CatalogExecutor,
  sql: string,
  values: unknown[],
): Promise<T[]> {
  const result = await executor.query<T>(sql, values);
  return result.rows;
}

async function relationExists(
  executor: CatalogExecutor,
  schema: string,
  name: string,
  kinds: string[],
): Promise<boolean> {
  const row = await firstRow<{ found: string }>(
    executor,
    `SELECT c.relname AS found
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = ANY($3::text[])`,
    [schema, name, kinds],
  );
  return Boolean(row);
}

async function listColumns(
  executor: CatalogExecutor,
  schema: string,
  name: string,
): Promise<Array<{ name: string; nullable: boolean }>> {
  const rows = await allRows<{ column_name: string; is_nullable: string }>(
    executor,
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, name],
  );
  return rows.map((row) => ({
    name: String(row.column_name),
    nullable: String(row.is_nullable).toUpperCase() === "YES",
  }));
}

function compareColumns(
  oracleColumns: DiscoveredColumn[] | undefined,
  pgColumns: Array<{ name: string; nullable: boolean }>,
): StructuralCheck[] {
  if (!oracleColumns || oracleColumns.length === 0) {
    return [
      {
        name: "columns",
        ok: pgColumns.length > 0,
        message:
          pgColumns.length > 0
            ? `${pgColumns.length} PostgreSQL columns present`
            : "No PostgreSQL columns found",
      },
    ];
  }
  const pgByName = new Map(pgColumns.map((column) => [column.name.toLowerCase(), column]));
  const checks: StructuralCheck[] = [];
  const missing: string[] = [];
  const lostNotNull: string[] = [];
  for (const column of oracleColumns) {
    const expected = catalogName(column.name);
    const actual = pgByName.get(expected.toLowerCase());
    if (!actual) {
      missing.push(expected);
      continue;
    }
    if (!column.nullable && actual.nullable) {
      lostNotNull.push(expected);
    }
  }
  checks.push({
    name: "columns.present",
    ok: missing.length === 0,
    message:
      missing.length === 0
        ? `All ${oracleColumns.length} Oracle columns exist in PostgreSQL`
        : `Converted PostgreSQL table is missing Oracle columns: ${missing.join(", ")}`,
  });
  checks.push({
    name: "columns.not_null",
    ok: lostNotNull.length === 0,
    message:
      lostNotNull.length === 0
        ? "NOT NULL flags preserved"
        : `Lost NOT NULL: ${lostNotNull.join(", ")}`,
  });
  return checks;
}

async function smokeSelect(
  executor: CatalogExecutor,
  schema: string,
  name: string,
): Promise<StructuralCheck> {
  try {
    await executor.query(`SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(name)} LIMIT 0`);
    return {
      name: "smoke.select",
      ok: true,
      message: "SELECT … LIMIT 0 succeeded",
    };
  } catch (error) {
    return {
      name: "smoke.select",
      ok: false,
      message: error instanceof Error ? error.message : "Smoke SELECT failed",
    };
  }
}

export async function runStructuralTests(
  executor: CatalogExecutor,
  input: StructuralTestInput,
): Promise<StructuralTestResult> {
  const started = Date.now();
  const schema = input.targetSchema ? catalogName(input.targetSchema) : "";
  const name = input.targetName ? catalogName(input.targetName) : "";
  if (!schema || !name) {
    return {
      ok: false,
      skipped: true,
      status: "SKIPPED",
      errorCode: "NO_TARGET",
      errorMessage: "No target schema/name to test",
      checks: [],
      durationMs: Date.now() - started,
    };
  }
  const timeoutMs = Math.max(1000, Math.floor(input.statementTimeoutMs ?? 15000));
  await executor.query(`SET statement_timeout = ${timeoutMs}`);
  const checks: StructuralCheck[] = [];
  const type = String(input.objectType).toUpperCase();
  try {
    if (type === "TABLE" || type === "CONSTRAINT") {
      const exists = await relationExists(executor, schema, name, type === "TABLE" ? ["r"] : ["r"]);
      if (type === "CONSTRAINT") {
        const constraint = await firstRow<{ constraint_name: string }>(
          executor,
          `SELECT constraint_name
           FROM information_schema.table_constraints
           WHERE constraint_schema = $1 AND constraint_name = $2`,
          [schema, name],
        );
        checks.push({
          name: "catalog.constraint",
          ok: Boolean(constraint),
          message: constraint
            ? `Constraint ${name} exists`
            : `Constraint ${schema}.${name} not found`,
        });
      } else {
        checks.push({
          name: "catalog.table",
          ok: exists,
          message: exists ? `Table ${schema}.${name} exists` : `Table ${schema}.${name} not found`,
        });
        if (exists) {
          const columns = await listColumns(executor, schema, name);
          checks.push(...compareColumns(input.oracleColumns, columns));
          checks.push(await smokeSelect(executor, schema, name));
        }
      }
    } else if (type === "VIEW") {
      const exists = await relationExists(executor, schema, name, ["v"]);
      checks.push({
        name: "catalog.view",
        ok: exists,
        message: exists ? `View ${schema}.${name} exists` : `View ${schema}.${name} not found`,
      });
      if (exists) {
        checks.push(await smokeSelect(executor, schema, name));
      }
    } else if (type === "SEQUENCE") {
      const exists = await relationExists(executor, schema, name, ["S"]);
      checks.push({
        name: "catalog.sequence",
        ok: exists,
        message: exists
          ? `Sequence ${schema}.${name} exists`
          : `Sequence ${schema}.${name} not found`,
      });
    } else if (type === "INDEX") {
      const index = await firstRow<{ indexname: string }>(
        executor,
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
        [schema, name],
      );
      checks.push({
        name: "catalog.index",
        ok: Boolean(index),
        message: index ? `Index ${name} exists` : `Index ${schema}.${name} not found`,
      });
    } else {
      return {
        ok: false,
        skipped: true,
        status: "SKIPPED",
        errorCode: "UNSUPPORTED_TYPE",
        errorMessage: `${type} has no structural tests in Phase 7`,
        checks: [],
        durationMs: Date.now() - started,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Structural test failed";
    return {
      ok: false,
      skipped: false,
      status: "FAILED",
      errorCode: "TEST_ERROR",
      errorMessage: message,
      checks,
      durationMs: Date.now() - started,
    };
  }
  const ok = checks.length > 0 && checks.every((check) => check.ok);
  const firstFail = checks.find((check) => !check.ok);
  return {
    ok,
    skipped: false,
    status: ok ? "PASSED" : "FAILED",
    errorCode: ok ? null : "STRUCTURAL_FAIL",
    errorMessage: firstFail?.message ?? null,
    checks,
    durationMs: Date.now() - started,
  };
}
