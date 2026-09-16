import { describe, expect, test } from "bun:test";
import { conversionObjectOrder, shouldConvertWithAi } from "./conversion.runner";

describe("conversionObjectOrder", () => {
  test("compiles sequences and tables before views", () => {
    expect(conversionObjectOrder("SEQUENCE")).toBeLessThan(conversionObjectOrder("TABLE"));
    expect(conversionObjectOrder("TABLE")).toBeLessThan(conversionObjectOrder("INDEX"));
    expect(conversionObjectOrder("INDEX")).toBeLessThan(conversionObjectOrder("CONSTRAINT"));
    expect(conversionObjectOrder("CONSTRAINT")).toBeLessThan(conversionObjectOrder("VIEW"));
  });

  test("skips AI when the PostgreSQL target already matches", () => {
    expect(shouldConvertWithAi("SKIP_UNCHANGED", true)).toBe(false);
    expect(shouldConvertWithAi("CREATE_REQUIRED", true)).toBe(true);
    expect(shouldConvertWithAi("UPDATE_REQUIRED", true)).toBe(true);
    expect(shouldConvertWithAi("SKIP_UNCHANGED", false)).toBe(false);
  });

  test("never uses AI for tables even when the PL/SQL track is on", () => {
    expect(shouldConvertWithAi("CREATE_REQUIRED", true, "TABLE")).toBe(false);
    expect(shouldConvertWithAi("CREATE_REQUIRED", true, "INDEX")).toBe(false);
    expect(shouldConvertWithAi("CREATE_REQUIRED", true, "PROCEDURE")).toBe(true);
  });
});
