import { describe, expect, test } from "bun:test";
import {
  isLockRenewalError,
  LOCK_RENEW_MS,
  LONG_RUNNING_LOCK_MS,
  longRunningWorkerOptions,
  QUEUE_NAMES,
  redisOptionsFromUrl,
} from "./index";

describe("queue config", () => {
  test("parses redis urls", () => {
    const options = redisOptionsFromUrl("redis://:secret@localhost:6380");
    expect(options.host).toBe("localhost");
    expect(options.port).toBe(6380);
    expect(options.password).toBe("secret");
    expect(options.maxRetriesPerRequest).toBeNull();
  });

  test("defines separated queues", () => {
    expect(QUEUE_NAMES.discovery).toBe("discovery");
    expect(QUEUE_NAMES.conversion).toBe("conversion");
    expect(QUEUE_NAMES.validation).toBe("validation");
    expect(QUEUE_NAMES.reporting).toBe("reporting");
    expect(QUEUE_NAMES.dataCopy).toBe("data-copy");
    expect(QUEUE_NAMES.deploy).toBe("deploy");
  });

  test("long-running workers keep a lock longer than the default 30s", () => {
    const options = longRunningWorkerOptions({ host: "localhost", port: 6379 }, { concurrency: 1 });
    expect(options.lockDuration).toBe(LONG_RUNNING_LOCK_MS);
    expect(options.lockRenewTime).toBe(LOCK_RENEW_MS);
    expect(options.concurrency).toBe(1);
    expect(isLockRenewalError(new Error("could not renew lock for job validation-1"))).toBe(true);
    expect(isLockRenewalError(new Error("redis down"))).toBe(false);
  });
});
