import type { AppEnv } from "@migrator/config";
import {
  AuditRepository,
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
import type { ReportingJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { runReport } from "./report.runner";

@Injectable()
export class ReportingQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportingQueueWorker.name);
  private worker: Worker<ReportingJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly validations: ValidationAttemptsRepository,
    private readonly tests: TestAttemptsRepository,
    private readonly reports: MigrationReportsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<ReportingJobData>(
      QUEUE_NAMES.reporting,
      async (job: Job<ReportingJobData>) => {
        this.logger.log(`report job ${job.id} run=${job.data.runId}`);
        await runReport({
          projectId: job.data.projectId,
          runId: job.data.runId,
          runs: this.runs,
          runObjects: this.runObjects,
          dependencies: this.dependencies,
          validations: this.validations,
          tests: this.tests,
          reports: this.reports,
          audit: this.audit,
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
