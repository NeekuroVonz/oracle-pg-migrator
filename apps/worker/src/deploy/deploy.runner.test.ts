import { describe, expect, test } from "bun:test";
import { applyObjectSql } from "./deploy.runner";

describe("applyObjectSql", () => {
  test("applies statements in order and stops on the first error", async () => {
    const seen: string[] = [];
    await applyObjectSql(async (sql) => {
      seen.push(sql);
    }, "CREATE SCHEMA IF NOT EXISTS hr; CREATE TABLE hr.emp (id int);");
    expect(seen).toEqual(["CREATE SCHEMA IF NOT EXISTS hr", "CREATE TABLE hr.emp (id int)"]);

    const partial: string[] = [];
    await expect(
      applyObjectSql(async (sql) => {
        partial.push(sql);
        if (sql.includes("TABLE")) {
          throw new Error("relation already exists");
        }
      }, "CREATE SCHEMA IF NOT EXISTS hr; CREATE TABLE hr.emp (id int); CREATE INDEX emp_pk ON hr.emp (id);"),
    ).rejects.toThrow("relation already exists");
    expect(partial).toEqual(["CREATE SCHEMA IF NOT EXISTS hr", "CREATE TABLE hr.emp (id int)"]);
  });

  test("rejects empty SQL", async () => {
    await expect(applyObjectSql(async () => undefined, "   ")).rejects.toThrow("No SQL to deploy");
  });
});
