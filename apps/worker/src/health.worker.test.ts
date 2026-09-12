import { describe, expect, test } from "bun:test";
import { QUEUE_NAMES } from "@migrator/queue";

describe("worker queues", () => {
  test("health queue is defined for Phase 1 boot", () => {
    expect(QUEUE_NAMES.health).toBe("health");
  });
});
