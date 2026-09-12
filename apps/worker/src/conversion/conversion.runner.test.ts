import { describe, expect, test } from "bun:test";
import { conversionObjectOrder, shouldConvertWithAi } from "./conversion.runner";

describe("conversionObjectOrder", () => {
  test("compiles sequences and tables before views", () => {
    expect(conversionObjectOrder("SEQUENCE")).toBeLessThan(conversionObjectOrder("TABLE"));
    expect(conversionObjectOrder("TABLE")).toBeLessThan(conversionObjectOrder("INDEX"));
    expect(conversionObjectOrder("INDEX")).toBeLessThan(conversionObjectOrder("VIEW"));
  });

  test("skips AI when the PostgreSQL target already matches", () => {
    expect(shouldConvertWithAi("SKIP_UNCHANGED", true)).toBe(false);
    expect(shouldConvertWithAi("CREATE_REQUIRED", true)).toBe(true);
    expect(shouldConvertWithAi("UPDATE_REQUIRED", true)).toBe(true);
    expect(shouldConvertWithAi("SKIP_UNCHANGED", false)).toBe(false);
  });
});
