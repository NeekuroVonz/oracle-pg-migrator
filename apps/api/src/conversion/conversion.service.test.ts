import { describe, expect, test } from "bun:test";

describe("conversion job ids", () => {
  test("never contain colons", () => {
    const runId = "7234aac0-3355-46ab-b152-f2567fc38505";
    expect(`conversion-${runId}`).not.toContain(":");
    expect(`validation-${runId}`).not.toContain(":");
    expect(`report-${runId}`).not.toContain(":");
    expect(`data-copy-${runId}`).not.toContain(":");
    expect(`deploy-${runId}`).not.toContain(":");
  });
});
