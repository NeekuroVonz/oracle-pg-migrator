import type { Client } from "pg";
import { qualifiedTable, quotePgIdent } from "./bulk-load";

export interface DependentView {
  schema: string;
  name: string;
  kind: "view" | "materialized_view";
  definition: string;
}

/** Views / matviews that reference a table. */
export async function listDependentViews(
  client: Client,
  schema: string,
  table: string,
): Promise<DependentView[]> {
  const result = await client.query<{
    schema: string;
    name: string;
    relkind: string;
    def: string;
  }>(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            c.relkind,
            pg_get_viewdef(c.oid, true) AS def
     FROM pg_depend d
     JOIN pg_rewrite r ON r.oid = d.objid
     JOIN pg_class c ON c.oid = r.ev_class AND c.relkind IN ('v', 'm')
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_class t ON t.oid = d.refobjid
     JOIN pg_namespace tn ON tn.oid = t.relnamespace
     WHERE tn.nspname = $1
       AND t.relname = $2
       AND d.deptype = 'n'
     GROUP BY n.nspname, c.relname, c.relkind, c.oid
     ORDER BY c.relkind DESC, n.nspname, c.relname`,
    [schema, table],
  );
  return result.rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    kind: row.relkind === "m" ? "materialized_view" : "view",
    definition: row.def,
  }));
}

export async function dropDependentViews(client: Client, views: DependentView[]): Promise<void> {
  for (const view of views) {
    const qualified = qualifiedTable(view.schema, view.name);
    if (view.kind === "materialized_view") {
      await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${qualified} CASCADE`);
    } else {
      await client.query(`DROP VIEW IF EXISTS ${qualified} CASCADE`);
    }
  }
}

export async function recreateDependentViews(client: Client, views: DependentView[]): Promise<void> {
  for (const view of [...views].reverse()) {
    const qualified = qualifiedTable(view.schema, view.name);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotePgIdent(view.schema)}`);
    const body = view.definition.replace(/;+\s*$/, "");
    if (view.kind === "materialized_view") {
      await client.query(`CREATE MATERIALIZED VIEW ${qualified} AS ${body}`);
    } else {
      await client.query(`CREATE OR REPLACE VIEW ${qualified} AS ${body}`);
    }
  }
}

/** Apply multi-statement SQL, temporarily dropping dependent views when needed. */
export async function applySqlDroppingDependentViews(
  client: Client,
  schema: string,
  table: string,
  sql: string,
  apply: (sql: string) => Promise<unknown>,
): Promise<void> {
  const views = await listDependentViews(client, schema, table);
  if (views.length === 0) {
    await apply(sql);
    return;
  }
  await dropDependentViews(client, views);
  try {
    await apply(sql);
  } finally {
    await recreateDependentViews(client, views);
  }
}
