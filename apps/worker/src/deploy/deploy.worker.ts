import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DeployObjectsRepository,
  DeployRunsRepository,
  DiscoveredObjectsRepository,
} from "@migrator/db";
import {
  logWorkerError,
  longRunningWorkerOptions,
  QUEUE_NAMES,
  redisOptionsFromUrl,
} from "@migrator/queue";
import type { DeployJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { runDeploy } from "./deploy.runner";

@Injectable()
export class DeployQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeployQueueWorker.name);
  private worker: Worker<DeployJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly connections: ConnectionsRepository,
    private readonly deployRuns: DeployRunsRepository,
    private readonly deployObjects: DeployObjectsRepository,
    private readonly discovered: DiscoveredObjectsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<DeployJobData>(
      QUEUE_NAMES.deploy,
      async (job: Job<DeployJobData>) => {
        this.logger.log(
          `deploy job ${job.id} run=${job.data.conversionRunId} deploy=${job.data.deployRunId}`,
        );
        await runDeploy({
          env: this.env,
          cipher: this.cipher,
          job: job.data,
          connections: this.connections,
          deployRuns: this.deployRuns,
          deployObjects: this.deployObjects,
          discovered: this.discovered,
          audit: this.audit,
        });
      },
      longRunningWorkerOptions(redisOptionsFromUrl(this.env.REDIS_URL), { concurrency: 1 }),
    );
    this.worker.on("error", (error) => logWorkerError(this.logger, error));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
