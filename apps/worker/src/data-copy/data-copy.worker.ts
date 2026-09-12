import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DataCopyRunsRepository,
  DataCopyTablesRepository,
  MigrationReportsRepository,
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
import type { DataCopyJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { runDataCopy } from "./data-copy.runner";

@Injectable()
export class DataCopyQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataCopyQueueWorker.name);
  private worker: Worker<DataCopyJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly connections: ConnectionsRepository,
    private readonly copyRuns: DataCopyRunsRepository,
    private readonly copyTables: DataCopyTablesRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly validations: ValidationAttemptsRepository,
    private readonly tests: TestAttemptsRepository,
    private readonly reports: MigrationReportsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<DataCopyJobData>(
      QUEUE_NAMES.dataCopy,
      async (job: Job<DataCopyJobData>) => {
        this.logger.log(
          `data-copy job ${job.id} run=${job.data.conversionRunId} copy=${job.data.copyRunId}`,
        );
        await runDataCopy({
          env: this.env,
          cipher: this.cipher,
          job: job.data,
          connections: this.connections,
          copyRuns: this.copyRuns,
          copyTables: this.copyTables,
          runs: this.runs,
          runObjects: this.runObjects,
          dependencies: this.dependencies,
          validations: this.validations,
          tests: this.tests,
          reports: this.reports,
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
