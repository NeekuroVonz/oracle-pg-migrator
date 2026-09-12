import { describe, expect, test } from "bun:test";
import { formatDatabaseError, isUniqueViolation } from "./pg-errors";

describe("isUniqueViolation", () => {
  test("detects a pg error code on the thrown object", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  test("walks drizzle Failed query cause chain", () => {
    const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const drizzleError = Object.assign(new Error("Failed query: insert into ..."), {
      cause: pgError,
    });
    expect(isUniqueViolation(drizzleError)).toBe(true);
  });

  test("returns false for other failures", () => {
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });
});

describe("formatDatabaseError", () => {
  test("prefers the postgres cause over a drizzle Failed query dump", () => {
    const pgError = new Error("bind message has 83040 parameter formats");
    const drizzleError = Object.assign(
      new Error("Failed query: insert into object_dependencies ..."),
      {
        cause: pgError,
      },
    );
    expect(formatDatabaseError(drizzleError)).toBe("bind message has 83040 parameter formats");
  });

  test("does not leak a giant Failed query when no cause is present", () => {
    expect(
      formatDatabaseError(new Error("Failed query: insert into object_dependencies ...")),
    ).toBe("Metadata database query failed");
  });

  test("keeps ordinary error messages", () => {
    expect(formatDatabaseError(new Error("connection refused"))).toBe("connection refused");
  });
});
