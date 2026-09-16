import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { compileSql, isDuplicateObjectError, splitSqlStatements } from "./compile";

describe("isDuplicateObjectError", () => {
  test("treats relation already exists as a duplicate, not a compile defect", () => {
    expect(
      isDuplicateObjectError({
        errorCode: "42P07",
        errorMessage: `relation "tco_buspartner" already exists`,
      }),
    ).toBe(true);
    expect(isDuplicateObjectError({ errorMessage: "syntax error at or near NOT" })).toBe(false);
    expect(
      isDuplicateObjectError({
        errorCode: "42710",
        errorMessage: `constraint "tac_abbudget_pk" already exists`,
      }),
    ).toBe(true);
    expect(
      isDuplicateObjectError({
        errorCode: "42P16",
        errorMessage: "multiple primary keys for table tac_abbudget are not allowed",
      }),
    ).toBe(true);
  });
});

describe("splitSqlStatements", () => {
  test("splits on semicolons outside quotes", () => {
    expect(
      splitSqlStatements(`CREATE SCHEMA IF NOT EXISTS hr; CREATE TABLE hr.t (id int);`),
    ).toEqual(["CREATE SCHEMA IF NOT EXISTS hr", "CREATE TABLE hr.t (id int)"]);
    expect(splitSqlStatements(`INSERT INTO t VALUES ('a;b');`)).toEqual([
      "INSERT INTO t VALUES ('a;b')",
    ]);
  });
});

const TEST_URL =
  process.env.VALIDATOR_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://migrator:migrator@127.0.0.1:5433/migrator";

describe("compileSql", () => {
  test("accepts valid DDL and records PostgreSQL errors", async () => {
    const client = new Client({ connectionString: TEST_URL, connectionTimeoutMillis: 1500 });
    try {
      await client.connect();
    } catch {
      return;
    }
    const schema = `compile_${Date.now()}`;
    try {
      const ok = await compileSql(
        client,
        `CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.ok (id integer PRIMARY KEY);`,
      );
      expect(ok.ok).toBe(true);
      const fail = await compileSql(client, `CREATE TABLE ${schema}.bad (id not_a_type);`);
      expect(fail.ok).toBe(false);
      expect(fail.errorMessage?.length).toBeGreaterThan(0);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });
});
