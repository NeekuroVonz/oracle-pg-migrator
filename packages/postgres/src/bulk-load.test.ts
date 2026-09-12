import { describe, expect, test } from "bun:test";
import { buildBulkInsertSql, quotePgIdent } from "./bulk-load";

describe("bulk load SQL", () => {
  test("builds parameterized inserts and lowercases Oracle-style names", () => {
    const sql = buildBulkInsertSql("HR", "EMP", ["EMPNO", "ENAME"], 2);
    expect(sql).toBe("INSERT INTO hr.emp (empno, ename) VALUES ($1, $2), ($3, $4)");
    expect(quotePgIdent("HR")).toBe("hr");
  });

  test("quotes mixed-case identifiers", () => {
    expect(quotePgIdent("EmpName")).toBe('"EmpName"');
  });
});
