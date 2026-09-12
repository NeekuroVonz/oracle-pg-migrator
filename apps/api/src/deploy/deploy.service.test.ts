import { describe, expect, test } from "bun:test";

describe("deploy job ids", () => {
  test("never contain colons", () => {
    const deployRunId = "7234aac0-3355-46ab-b152-f2567fc38505";
    expect(`deploy-${deployRunId}`).not.toContain(":");
  });
});
