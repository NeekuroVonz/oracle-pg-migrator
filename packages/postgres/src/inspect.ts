import type { PgObjectShape, PgShapeKind, PgSslMode } from "@migrator/shared";
import type { PostgresTargetConfig } from "./connection-test";

export interface PgCatalogExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function postgresConfigFromConnection(input: {
  host: string | null;
  port: number | null;
  databaseName: string | null;
  username: string;
  password: string;
  sslMode: PgSslMode | null;
  connectionTimeoutMs: number;
}): PostgresTargetConfig {
  return {
    host: input.host ?? "localhost",
    port: input.port ?? 5432,
    database: input.databaseName ?? "postgres",
    username: input.username,
    password: input.password,
    sslMode: input.sslMode ?? "prefer",
    connectionTimeoutMs: input.connectionTimeoutMs,
  };
}

async function firstRow<T extends Record<string, unknown>>(
  executor: PgCatalogExecutor,
  sql: string,
  values: unknown[],
): Promise<T | undefined> {
  const result = await executor.query<T>(sql, values);
  return result.rows[0];
}

async function allRows<T extends Record<string, unknown>>(
  executor: PgCatalogExecutor,
  sql: string,
  values: unknown[],
): Promise<T[]> {
  const result = await executor.query<T>(sql, values);
  return result.rows;
}

const SYSTEM_NAMESPACES = ["pg_catalog", "information_schema", "pg_toast"];

/** pg may return text[] as JS array or as "{a,b}" depending on driver/settings. */
function normalizePgTextArray(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "{}" || trimmed === "") {
      return [];
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((part) => part.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

function kindForObjectType(objectType: string): PgShapeKind | null {
  switch (objectType.toUpperCase()) {
    case "TABLE":
      return "table";
    case "INDEX":
      return "index";
    case "SEQUENCE":
      return "sequence";
    case "VIEW":
      return "view";
    case "MATERIALIZED_VIEW":
      return "materialized_view";
    case "FUNCTION":
      return "function";
    case "PROCEDURE":
      return "procedure";
    case "TRIGGER":
      return "trigger";
    case "CONSTRAINT":
      return "constraint";
    default:
      return null;
  }
}

function relkindsFor(kind: PgShapeKind): string[] | null {
  switch (kind) {
    case "table":
      return ["r", "p"];
    case "index":
      return ["i"];
    case "sequence":
      return ["S"];
    case "view":
      return ["v"];
    case "materialized_view":
      return ["m"];
    default:
      return null;
  }
}

async function resolveClassNamespace(
  executor: PgCatalogExecutor,
  preferredSchema: string,
  name: string,
  relkinds: string[],
): Promise<string | null> {
  const preferred = preferredSchema.trim();
  if (preferred) {
    const exact = await firstRow<{ nspname: string }>(
      executor,
      `SELECT n.nspname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = ANY($3::text[])`,
      [preferred, name, relkinds],
    );
    return exact?.nspname ?? null;
  }
  const fallback = await firstRow<{ nspname: string }>(
    executor,
    `SELECT n.nspname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = $1
       AND c.relkind = ANY($2::text[])
       AND n.nspname <> ALL($3::text[])
       AND n.nspname NOT LIKE 'pg_%'
     ORDER BY (n.nspname = 'public')::int DESC, n.nspname
     LIMIT 1`,
    [name, relkinds, SYSTEM_NAMESPACES],
  );
  return fallback?.nspname ?? null;
}

async function resolveProcNamespace(
  executor: PgCatalogExecutor,
  preferredSchema: string,
  name: string,
  procedure: boolean,
): Promise<string | null> {
  const prokind = procedure ? "p" : "f";
  const preferred = preferredSchema.trim();
  if (preferred) {
    const exact = await firstRow<{ nspname: string }>(
      executor,
      `SELECT n.nspname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = $3
       ORDER BY p.oid
       LIMIT 1`,
      [preferred, name, prokind],
    );
    if (exact) {
      return exact.nspname;
    }
    return null;
  }
  const fallback = await firstRow<{ nspname: string }>(
    executor,
    `SELECT n.nspname
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = $1
       AND p.prokind = $2
       AND n.nspname <> ALL($3::text[])
       AND n.nspname NOT LIKE 'pg_%'
     ORDER BY (n.nspname = 'public')::int DESC, n.nspname, p.oid
     LIMIT 1`,
    [name, prokind, SYSTEM_NAMESPACES],
  );
  return fallback?.nspname ?? null;
}

async function resolveTriggerNamespace(
  executor: PgCatalogExecutor,
  preferredSchema: string,
  name: string,
): Promise<string | null> {
  const preferred = preferredSchema.trim();
  if (preferred) {
    const exact = await firstRow<{ nspname: string }>(
      executor,
      `SELECT n.nspname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND t.tgname = $2 AND NOT t.tgisinternal
       LIMIT 1`,
      [preferred, name],
    );
    if (exact) {
      return exact.nspname;
    }
    return null;
  }
  const fallback = await firstRow<{ nspname: string }>(
    executor,
    `SELECT n.nspname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE t.tgname = $1
       AND NOT t.tgisinternal
       AND n.nspname <> ALL($2::text[])
       AND n.nspname NOT LIKE 'pg_%'
     ORDER BY (n.nspname = 'public')::int DESC, n.nspname
     LIMIT 1`,
    [name, SYSTEM_NAMESPACES],
  );
  return fallback?.nspname ?? null;
}

async function resolveConstraintNamespace(
  executor: PgCatalogExecutor,
  preferredSchema: string,
  name: string,
): Promise<string | null> {
  const preferred = preferredSchema.trim();
  if (preferred) {
    const exact = await firstRow<{ nspname: string }>(
      executor,
      `SELECT n.nspname
       FROM pg_constraint con
       JOIN pg_namespace n ON n.oid = con.connamespace
       WHERE n.nspname = $1 AND con.conname = $2
       LIMIT 1`,
      [preferred, name],
    );
    if (exact) {
      return exact.nspname;
    }
    return null;
  }
  const fallback = await firstRow<{ nspname: string }>(
    executor,
    `SELECT n.nspname
     FROM pg_constraint con
     JOIN pg_namespace n ON n.oid = con.connamespace
     WHERE con.conname = $1
       AND n.nspname <> ALL($2::text[])
       AND n.nspname NOT LIKE 'pg_%'
     ORDER BY (n.nspname = 'public')::int DESC, n.nspname
     LIMIT 1`,
    [name, SYSTEM_NAMESPACES],
  );
  return fallback?.nspname ?? null;
}

async function resolveTargetNamespace(
  executor: PgCatalogExecutor,
  kind: PgShapeKind,
  schema: string,
  name: string,
): Promise<string | null> {
  const relkinds = relkindsFor(kind);
  if (relkinds) {
    return resolveClassNamespace(executor, schema, name, relkinds);
  }
  if (kind === "function" || kind === "procedure") {
    return resolveProcNamespace(executor, schema, name, kind === "procedure");
  }
  if (kind === "trigger") {
    return resolveTriggerNamespace(executor, schema, name);
  }
  if (kind === "constraint") {
    return resolveConstraintNamespace(executor, schema, name);
  }
  return schema.trim() || null;
}

async function inspectTable(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<PgObjectShape | null> {
  const rel = await firstRow<{ oid: string }>(
    executor,
    `SELECT c.oid::text AS oid
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = ANY($3::text[])`,
    [schema, name, ["r", "p"]],
  );
  if (!rel) {
    return null;
  }
  const columns = await allRows<{
    attname: string;
    typ: string;
    attnotnull: boolean;
    def: string | null;
  }>(
    executor,
    `SELECT a.attname,
            format_type(a.atttypid, a.atttypmod) AS typ,
            a.attnotnull,
            pg_get_expr(ad.adbin, ad.adrelid) AS def
     FROM pg_attribute a
     LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [rel.oid],
  );
  const constraints = await allRows<{
    conname: string;
    contype: string;
    def: string;
    cols: string[] | null;
    fschema: string | null;
    ftable: string | null;
    fcols: string[] | null;
  }>(
    executor,
    `SELECT con.conname,
            con.contype,
            pg_get_constraintdef(con.oid) AS def,
            (SELECT array_agg(att.attname ORDER BY ord.ordinality)
             FROM unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
             JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum) AS cols,
            fn.nspname AS fschema,
            fc.relname AS ftable,
            (SELECT array_agg(att.attname ORDER BY ord.ordinality)
             FROM unnest(con.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
             JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = ord.attnum) AS fcols
     FROM pg_constraint con
     LEFT JOIN pg_class fc ON fc.oid = con.confrelid
     LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
     WHERE con.conrelid = $1::oid AND con.contype IN ('p', 'u', 'c', 'f')`,
    [rel.oid],
  );
  const kindMap = {
    p: "PRIMARY KEY",
    u: "UNIQUE",
    c: "CHECK",
    f: "FOREIGN KEY",
  } as const;
  return {
    kind: "table",
    schema,
    name,
    columns: columns.map((column) => ({
      name: column.attname,
      type: column.typ,
      nullable: !column.attnotnull,
      default: column.def,
    })),
    constraints: constraints.map((constraint) => ({
      name: constraint.conname,
      kind: kindMap[constraint.contype as keyof typeof kindMap] ?? "CHECK",
      columns: normalizePgTextArray(constraint.cols),
      definition: constraint.def,
      referencedSchema: constraint.fschema,
      referencedTable: constraint.ftable,
      referencedColumns: normalizePgTextArray(constraint.fcols),
    })),
  };
}

async function inspectIndex(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<PgObjectShape | null> {
  const row = await firstRow<{
    schemaname: string;
    indexname: string;
    tablename: string;
    indexdef: string;
  }>(
    executor,
    `SELECT schemaname, indexname, tablename, indexdef
     FROM pg_indexes
     WHERE schemaname = $1 AND indexname = $2`,
    [schema, name],
  );
  if (!row) {
    return null;
  }
  const unique = /\bunique\b/i.test(row.indexdef);
  const method = /\busing\s+(\w+)/i.exec(row.indexdef)?.[1] ?? "btree";
  const cols = /\((.*)\)\s*$/s.exec(row.indexdef)?.[1] ?? "";
  return {
    kind: "index",
    schema: row.schemaname,
    name: row.indexname,
    tableSchema: row.schemaname,
    tableName: row.tablename,
    unique,
    method,
    columns: cols
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  };
}

async function inspectSequence(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<PgObjectShape | null> {
  const row = await firstRow<{
    increment_by: string;
    min_value: string | null;
    max_value: string | null;
    cycle: boolean;
    cache_size: string;
  }>(
    executor,
    `SELECT increment_by::text, min_value::text, max_value::text, cycle, cache_size::text
     FROM pg_sequences
     WHERE schemaname = $1 AND sequencename = $2`,
    [schema, name],
  );
  if (!row) {
    return null;
  }
  return {
    kind: "sequence",
    schema,
    name,
    increment: row.increment_by,
    minValue: row.min_value,
    maxValue: row.max_value,
    cycle: row.cycle,
    cache: row.cache_size,
  };
}

async function inspectView(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
  materialized: boolean,
): Promise<PgObjectShape | null> {
  const relkind = materialized ? "m" : "v";
  const row = await firstRow<{ def: string }>(
    executor,
    `SELECT pg_get_viewdef(c.oid, true) AS def
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = $3`,
    [schema, name, relkind],
  );
  if (!row) {
    return null;
  }
  return {
    kind: materialized ? "materialized_view" : "view",
    schema,
    name,
    definition: row.def,
  };
}

async function inspectRoutine(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
  procedure: boolean,
): Promise<PgObjectShape | null> {
  const row = await firstRow<{ args: string; def: string }>(
    executor,
    `SELECT pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_functiondef(p.oid) AS def
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = $3
     ORDER BY p.oid
     LIMIT 1`,
    [schema, name, procedure ? "p" : "f"],
  );
  if (!row) {
    return null;
  }
  return {
    kind: procedure ? "procedure" : "function",
    schema,
    name,
    identityArgs: row.args,
    definition: row.def,
  };
}

async function inspectTrigger(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<PgObjectShape | null> {
  const row = await firstRow<{ def: string; table_name: string }>(
    executor,
    `SELECT pg_get_triggerdef(t.oid) AS def, c.relname AS table_name
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND t.tgname = $2 AND NOT t.tgisinternal
     LIMIT 1`,
    [schema, name],
  );
  if (!row) {
    return null;
  }
  return {
    kind: "trigger",
    schema,
    name,
    tableName: row.table_name,
    definition: row.def,
  };
}

async function inspectConstraint(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<PgObjectShape | null> {
  const row = await firstRow<{
    table_name: string;
    conname: string;
    contype: string;
    def: string;
    cols: string[] | null;
    fschema: string | null;
    ftable: string | null;
    fcols: string[] | null;
  }>(
    executor,
    `SELECT c.relname AS table_name,
            con.conname,
            con.contype,
            pg_get_constraintdef(con.oid) AS def,
            (SELECT array_agg(att.attname ORDER BY ord.ordinality)
             FROM unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
             JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum) AS cols,
            fn.nspname AS fschema,
            fc.relname AS ftable,
            (SELECT array_agg(att.attname ORDER BY ord.ordinality)
             FROM unnest(con.confkey) WITH ORDINALITY AS ord(attnum, ordinality)
             JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = ord.attnum) AS fcols
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = con.connamespace
     LEFT JOIN pg_class fc ON fc.oid = con.confrelid
     LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
     WHERE n.nspname = $1 AND con.conname = $2
     LIMIT 1`,
    [schema, name],
  );
  if (!row) {
    return null;
  }
  const kindMap = {
    p: "PRIMARY KEY",
    u: "UNIQUE",
    c: "CHECK",
    f: "FOREIGN KEY",
  } as const;
  return {
    kind: "constraint",
    schema,
    name,
    tableName: row.table_name,
    constraint: {
      name: row.conname,
      kind: kindMap[row.contype as keyof typeof kindMap] ?? "CHECK",
      columns: row.cols ?? [],
      definition: row.def,
      referencedSchema: row.fschema,
      referencedTable: row.ftable,
      referencedColumns: row.fcols ?? [],
    },
  };
}

export async function inspectTargetObject(
  executor: PgCatalogExecutor,
  input: { objectType: string; schema: string; name: string },
): Promise<PgObjectShape | null> {
  const kind = kindForObjectType(input.objectType);
  if (!kind) {
    return null;
  }
  const schema = await resolveTargetNamespace(executor, kind, input.schema, input.name);
  if (!schema) {
    return null;
  }
  switch (kind) {
    case "table":
      return inspectTable(executor, schema, input.name);
    case "index":
      return inspectIndex(executor, schema, input.name);
    case "sequence":
      return inspectSequence(executor, schema, input.name);
    case "view":
      return inspectView(executor, schema, input.name, false);
    case "materialized_view":
      return inspectView(executor, schema, input.name, true);
    case "function":
      return inspectRoutine(executor, schema, input.name, false);
    case "procedure":
      return inspectRoutine(executor, schema, input.name, true);
    case "trigger":
      return inspectTrigger(executor, schema, input.name);
    case "constraint":
      return inspectConstraint(executor, schema, input.name);
  }
}

export async function countTargetRows(
  executor: PgCatalogExecutor,
  schema: string,
  name: string,
): Promise<number | null> {
  try {
    const row = await firstRow<{ n: string }>(
      executor,
      `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(name)}`,
      [],
    );
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replaceAll('"', '""')}"`;
}

export { kindForObjectType };
