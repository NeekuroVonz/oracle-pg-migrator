import { describe, expect, test } from "bun:test";
import { inspectTargetObject, type PgCatalogExecutor } from "./inspect";

function tableExecutor(tables: Array<{ schema: string; name: string; oid: string }>): PgCatalogExecutor {
  return {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("SELECT n.nspname") && sql.includes("n.nspname = $1 AND c.relname = $2")) {
        const schema = String(values[0]);
        const name = String(values[1]);
        const hit = tables.find((table) => table.schema === schema && table.name === name);
        return { rows: hit ? [{ nspname: hit.schema }] : [] };
      }
      if (sql.includes("SELECT n.nspname") && sql.includes("NOT LIKE 'pg_%'")) {
        const name = String(values[0]);
        const hit = tables.find((table) => table.name === name);
        return { rows: hit ? [{ nspname: hit.schema }] : [] };
      }
      if (sql.includes("AS oid")) {
        const schema = String(values[0]);
        const name = String(values[1]);
        const hit = tables.find((table) => table.schema === schema && table.name === name);
        return { rows: hit ? [{ oid: hit.oid }] : [] };
      }
      if (sql.includes("FROM pg_attribute")) {
        return {
          rows: [{ attname: "pk", typ: "bigint", attnotnull: true, def: null }],
        };
      }
      if (sql.includes("FROM pg_constraint")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe("inspectTargetObject", () => {
  test("does not treat a public leftover as the WMS1 table", async () => {
    const shape = await inspectTargetObject(tableExecutor([{ schema: "public", name: "mail", oid: "11" }]), {
      objectType: "TABLE",
      schema: "wms1",
      name: "mail",
    });
    expect(shape).toBeNull();
  });
});
