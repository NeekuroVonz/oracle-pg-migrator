import { type ConnectionOptions, Queue, type WorkerOptions } from "bullmq";
import IORedis, { type RedisOptions } from "ioredis";

/** Default BullMQ lock is 30s; conversion/validation of large catalogs exceeds that. */
export const LONG_RUNNING_LOCK_MS = 10 * 60 * 1000;
export const LOCK_RENEW_MS = 15_000;

export function longRunningWorkerOptions(
  connection: ConnectionOptions,
  extra?: Omit<WorkerOptions, "connection">,
): WorkerOptions {
  return {
    connection,
    lockDuration: LONG_RUNNING_LOCK_MS,
    lockRenewTime: LOCK_RENEW_MS,
    stalledInterval: 60_000,
    maxStalledCount: 1,
    ...extra,
  };
}

const warnedLockJobs = new Set<string>();

export function isLockRenewalError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("could not renew lock for job");
}

export function logWorkerError(
  logger: { error: (message: unknown) => void; warn: (message: string) => void },
  error: Error,
): void {
  const match = /^could not renew lock for job (.+)$/.exec(error.message);
  if (match) {
    const jobId = match[1] ?? error.message;
    if (!warnedLockJobs.has(jobId)) {
      warnedLockJobs.add(jobId);
      logger.warn(
        `Could not renew lock for job ${jobId}. Redis no longer holds this worker's lock (stalled or restarted). Further lock errors for this job are suppressed.`,
      );
    }
    return;
  }
  logger.error(error);
}

export const QUEUE_NAMES = {
  health: "health",
  discovery: "discovery",
  conversion: "conversion",
  validation: "validation",
  reporting: "reporting",
  dataCopy: "data-copy",
  deploy: "deploy",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function redisOptionsFromUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisOptionsFromUrl(redisUrl));
}

export function createQueue<T>(name: QueueName, redisUrl: string): Queue<T> {
  return new Queue<T>(name, { connection: redisOptionsFromUrl(redisUrl) });
}

export async function pingRedis(redisUrl: string): Promise<boolean> {
  const client = new IORedis({
    ...redisOptionsFromUrl(redisUrl),
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  try {
    const result = await client.ping();
    return result === "PONG";
  } finally {
    client.disconnect();
  }
}
