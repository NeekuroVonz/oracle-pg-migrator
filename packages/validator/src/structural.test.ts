import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { catalogName, quoteIdent, runStructuralTests } from "./structural";

describe("catalog identifiers", () => {
  test("lowercases unquoted Oracle names and preserves quoted mixed case", () => {
    expect(catalogName("EMPLOYEES")).toBe("employees");
    expect(catalogName('"WeirdName"')).toBe("WeirdName");
    expect(quoteIdent("hr")).toBe('"hr"');
  });
});

const TEST_URL =
  process.env.VALIDATOR_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://migrator:migrator@127.0.0.1:5433/migrator";

describe("runStructuralTests", () => {
  test("skips when there is no target schema or name", async () => {
    const skipped = await runStructuralTests(
      { query: async () => ({ rows: [] }) },
      { objectType: "TABLE", targetSchema: null, targetName: null },
    );
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.ok).toBe(false);
  });

  test("skips unsupported object types", async () => {
    const skipped = await runStructuralTests(
      { query: async () => ({ rows: [] }) },
      { objectType: "FUNCTION", targetSchema: "hr", targetName: "bonus" },
    );
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.errorCode).toBe("UNSUPPORTED_TYPE");
  });

  test("passes when a compiled table matches Oracle columns", async () => {
    const client = new Client({ connectionString: TEST_URL, connectionTimeoutMillis: 1500 });
    try {
      await client.connect();
    } catch {
      return;
    }
    const schema = `struct_${Date.now()}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(
        `CREATE TABLE ${schema}.employees (employee_id integer NOT NULL, first_name varchar(20))`,
      );
      const passed = await runStructuralTests(client, {
        objectType: "TABLE",
        targetSchema: schema,
        targetName: "employees",
        oracleColumns: [
          {
            name: "EMPLOYEE_ID",
            dataType: "NUMBER",
            nullable: false,
            dataLength: null,
            dataPrecision: 6,
            dataScale: 0,
            columnId: 1,
          },
          {
            name: "FIRST_NAME",
            dataType: "VARCHAR2",
            nullable: true,
            dataLength: 20,
            dataPrecision: null,
            dataScale: null,
            columnId: 2,
          },
        ],
      });
      expect(passed.status).toBe("PASSED");
      expect(passed.ok).toBe(true);

      const missing = await runStructuralTests(client, {
        objectType: "TABLE",
        targetSchema: schema,
        targetName: "missing",
      });
      expect(missing.status).toBe("FAILED");
      expect(missing.ok).toBe(false);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
