import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AiProvidersRepository,
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ObjectDependenciesRepository,
} from "@migrator/db";
import {
  logWorkerError,
  longRunningWorkerOptions,
  QUEUE_NAMES,
  redisOptionsFromUrl,
} from "@migrator/queue";
import type { ConversionJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { loadAiRuntime } from "../ai/runtime";
import { runConversion } from "./conversion.runner";

@Injectable()
export class ConversionQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversionQueueWorker.name);
  private worker: Worker<ConversionJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly scopes: MigrationScopesRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly attempts: ConversionAttemptsRepository,
    private readonly audit: AuditRepository,
    private readonly connections: ConnectionsRepository,
    private readonly aiProviders: AiProvidersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<ConversionJobData>(
      QUEUE_NAMES.conversion,
      async (job: Job<ConversionJobData>) => {
        this.logger.log(
          `conversion job ${job.id} project=${job.data.projectId} run=${job.data.runId}`,
        );
        const ai = await loadAiRuntime({
          env: this.env,
          providers: this.aiProviders,
          cipher: this.cipher,
        });
        await runConversion({
          env: this.env,
          cipher: this.cipher,
          projectId: job.data.projectId,
          runId: job.data.runId,
          runs: this.runs,
          runObjects: this.runObjects,
          objects: this.objects,
          scopes: this.scopes,
          dependencies: this.dependencies,
          attempts: this.attempts,
          audit: this.audit,
          connections: this.connections,
          ai,
        });
      },
      longRunningWorkerOptions(redisOptionsFromUrl(this.env.REDIS_URL), { concurrency: 2 }),
    );
    this.worker.on("error", (error) => logWorkerError(this.logger, error));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
