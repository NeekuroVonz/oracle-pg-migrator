import { describe, expect, test } from "bun:test";
import { classifyOracleSql } from "./sql-classifier";
import { buildTableChunkSql, buildTableCountSql, quoteOracleIdent } from "./table-chunk";

describe("table chunk SQL", () => {
  test("count and chunk statements classify as SELECT", () => {
    const count = buildTableCountSql("HR", "EMP");
    const chunk = buildTableChunkSql({
      owner: "HR",
      name: "EMP",
      columns: ["EMPNO", "ENAME"],
      offset: 0,
      limit: 1000,
    });
    expect(classifyOracleSql(count).kind).toBe("SELECT");
    expect(classifyOracleSql(chunk).kind).toBe("SELECT");
    expect(count).toBe('SELECT COUNT(*) FROM "HR"."EMP"');
    expect(chunk).toContain('SELECT "EMPNO", "ENAME" FROM "HR"."EMP"');
    expect(chunk).toContain("OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY");
  });

  test("quotes identifiers and never emits DML", () => {
    const sql = buildTableChunkSql({
      owner: 'HR"',
      name: "EMP",
      columns: ["NAME"],
      offset: 10,
      limit: 50,
    });
    expect(sql).toContain('"HR"""');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
    expect(quoteOracleIdent("EMP")).toBe('"EMP"');
  });
});
