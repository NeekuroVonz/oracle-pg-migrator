import type { AppEnv } from "@migrator/config";
import { pingDatabase } from "@migrator/db";
import { logWorkerError, pingRedis, QUEUE_NAMES, redisOptionsFromUrl } from "@migrator/queue";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import type { Pool } from "pg";

@Injectable()
export class HealthQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthQueueWorker.name);
  private worker: Worker | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      QUEUE_NAMES.health,
      async (job: Job<{ ping?: string }>) => {
        this.logger.log(`health job ${job.id}`);
        return { ok: true as const, jobId: String(job.id) };
      },
      {
        connection: redisOptionsFromUrl(this.env.REDIS_URL),
        concurrency: 32,
      },
    );
    this.worker.on("error", (error) => logWorkerError(this.logger, error));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  async readiness(): Promise<{ status: string; database: boolean; redis: boolean }> {
    const database = await pingDatabase(this.pool);
    const redis = await pingRedis(this.env.REDIS_URL);
    return {
      status: database && redis ? "ok" : "degraded",
      database,
      redis,
    };
  }
}
