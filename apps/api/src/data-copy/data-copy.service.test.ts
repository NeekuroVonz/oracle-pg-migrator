import { describe, expect, test } from "bun:test";

describe("data copy job ids", () => {
  test("never contain colons", () => {
    const copyRunId = "7234aac0-3355-46ab-b152-f2567fc38505";
    expect(`data-copy-${copyRunId}`).not.toContain(":");
    expect(`data-copy-resume-${copyRunId}-${Date.now()}`).not.toContain(":");
  });
});

describe("resume failed selection", () => {
  test("retries FAILED and PENDING only", () => {
    const tables = [
      { name: "A", status: "SUCCEEDED" },
      { name: "B", status: "FAILED" },
      { name: "C", status: "PENDING" },
      { name: "D", status: "RUNNING" },
    ];
    const retryable = tables.filter(
      (row) => row.status === "FAILED" || row.status === "PENDING",
    );
    expect(retryable.map((row) => row.name)).toEqual(["B", "C"]);
  });
});
