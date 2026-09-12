import { describe, expect, test } from "bun:test";
import { pageCount, paginate } from "./pagination";

describe("paginate", () => {
  test("slices the current page and clamps out-of-range pages", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(paginate(items, 1, 2)).toEqual(["a", "b"]);
    expect(paginate(items, 3, 2)).toEqual(["e"]);
    expect(paginate(items, 99, 2)).toEqual(["e"]);
    expect(pageCount(5, 2)).toBe(3);
  });
});
