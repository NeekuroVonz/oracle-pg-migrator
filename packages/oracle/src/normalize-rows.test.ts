import { describe, expect, test } from "bun:test";
import { normalizeOracleCell, normalizeOracleRows } from "./normalize-rows";

describe("normalizeOracleCell", () => {
  test("passes through primitives and buffers", async () => {
    expect(await normalizeOracleCell(null)).toBeNull();
    expect(await normalizeOracleCell(12)).toBe(12);
    expect(await normalizeOracleCell("x")).toBe("x");
    const buf = Buffer.from("hi");
    expect(await normalizeOracleCell(buf)).toBe(buf);
  });

  test("reads Lob-like getData and avoids cyclic stringify", async () => {
    const lob: { iLob: unknown; getData: () => Promise<Buffer> } = {
      iLob: null as unknown,
      getData: async () => Buffer.from([1, 2, 3]),
    };
    lob.iLob = lob;
    expect(() => JSON.stringify(lob)).toThrow();
    const value = await normalizeOracleCell(lob);
    expect(Buffer.isBuffer(value)).toBe(true);
    expect(JSON.stringify([value])).toBeTruthy();
  });

  test("normalizes whole row chunks", async () => {
    const rows = await normalizeOracleRows([
      [1, { getData: async () => "photo" }],
      ["a", null],
    ]);
    expect(rows).toEqual([
      [1, "photo"],
      ["a", null],
    ]);
  });
});
