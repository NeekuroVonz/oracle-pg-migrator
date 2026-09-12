import { describe, expect, test } from "bun:test";
import { catalogViewName, isMissingOracleDictionary, wrapOracleQueryError } from "./oracle-errors";

describe("oracle dictionary errors", () => {
  test("detects missing table/view errors", () => {
    expect(isMissingOracleDictionary(new Error("ORA-00942: table or view does not exist"))).toBe(
      true,
    );
    expect(isMissingOracleDictionary(new Error("connection refused"))).toBe(false);
  });

  test("names the dictionary view in wrapped errors", () => {
    const error = wrapOracleQueryError(
      "SELECT OWNER, BYTES FROM ALL_SEGMENTS WHERE OWNER = :owner",
      new Error("ORA-00942: table or view does not exist"),
    );
    expect(catalogViewName("SELECT * FROM ALL_LOBS")).toBe("ALL_LOBS");
    expect(error.message).toContain("ALL_SEGMENTS");
    expect(error.message).toContain("ORA-00942");
    expect(wrapOracleQueryError("SELECT * FROM ALL_SEGMENTS", error).message).toBe(error.message);
  });
});
