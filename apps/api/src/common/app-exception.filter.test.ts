import { describe, expect, test } from "bun:test";
import { isPayloadTooLargeError } from "./app-exception.filter";

describe("isPayloadTooLargeError", () => {
  test("detects Express body-parser overflow errors", () => {
    const error = Object.assign(new Error("request entity too large"), {
      name: "PayloadTooLargeError",
      type: "entity.too.large",
      status: 413,
      statusCode: 413,
    });
    expect(isPayloadTooLargeError(error)).toBe(true);
    expect(isPayloadTooLargeError(new Error("connection refused"))).toBe(false);
  });
});
