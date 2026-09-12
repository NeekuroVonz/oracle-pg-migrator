import { describe, expect, test } from "bun:test";

describe("data copy job ids", () => {
  test("never contain colons", () => {
    const copyRunId = "7234aac0-3355-46ab-b152-f2567fc38505";
    expect(`data-copy-${copyRunId}`).not.toContain(":");
  });
});
