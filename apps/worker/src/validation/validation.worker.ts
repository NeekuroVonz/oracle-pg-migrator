import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AiProvidersRepository,
  AuditRepository,
  ConnectionsRepository,
  ConversionAttemptsRepository,
  DiscoveredObjectsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  ObjectDependenciesRepository,
  TestAttemptsRepository,
  ValidationAttemptsRepository,
} from "@migrator/db";
import {
  logWorkerError,
  longRunningWorkerOptions,
  QUEUE_NAMES,
  redisOptionsFromUrl,
} from "@migrator/queue";
import type { ValidationJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { loadAiRuntime } from "../ai/runtime";
import { runValidation } from "./validation.runner";

@Injectable()
export class ValidationQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValidationQueueWorker.name);
  private worker: Worker<ValidationJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly validations: ValidationAttemptsRepository,
    private readonly attempts: ConversionAttemptsRepository,
    private readonly testAttempts: TestAttemptsRepository,
    private readonly audit: AuditRepository,
    private readonly connections: ConnectionsRepository,
    private readonly aiProviders: AiProvidersRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<ValidationJobData>(
      QUEUE_NAMES.validation,
      async (job: Job<ValidationJobData>) => {
        this.logger.log(
          `validation job ${job.id} project=${job.data.projectId} run=${job.data.runId}`,
        );
        const ai = await loadAiRuntime({
          env: this.env,
          providers: this.aiProviders,
          cipher: this.cipher,
        });
        await runValidation({
          env: this.env,
          cipher: this.cipher,
          projectId: job.data.projectId,
          runId: job.data.runId,
          runs: this.runs,
          runObjects: this.runObjects,
          objects: this.objects,
          dependencies: this.dependencies,
          validations: this.validations,
          attempts: this.attempts,
          testAttempts: this.testAttempts,
          audit: this.audit,
          connections: this.connections,
          ai,
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
