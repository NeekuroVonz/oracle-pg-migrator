import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DiscoveredObjectsRepository,
  DiscoveryRunsRepository,
  ObjectDependenciesRepository,
} from "@migrator/db";
import {
  logWorkerError,
  longRunningWorkerOptions,
  QUEUE_NAMES,
  redisOptionsFromUrl,
} from "@migrator/queue";
import type { DiscoveryJobData } from "@migrator/shared";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { runDiscovery } from "./discovery.runner";
import { oracleClientFromRow } from "./oracle-from-row";

@Injectable()
export class DiscoveryQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryQueueWorker.name);
  private worker: Worker<DiscoveryJobData> | undefined;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly connections: ConnectionsRepository,
    private readonly runs: DiscoveryRunsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly audit: AuditRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<DiscoveryJobData>(
      QUEUE_NAMES.discovery,
      async (job: Job<DiscoveryJobData>) => {
        const { projectId, runId, connectionId, schemas } = job.data;
        this.logger.log(`discovery job ${job.id} project=${projectId} run=${runId}`);
        const connection = await this.connections.getByIdOrThrow(connectionId);
        const password = this.cipher.decrypt(connection.passwordCiphertext);
        const client = oracleClientFromRow(
          connection,
          password,
          this.env.ORACLE_STATEMENT_TIMEOUT_MS,
        );
        await runDiscovery({
          projectId,
          runId,
          schemas,
          client,
          runs: this.runs,
          objects: this.objects,
          dependencies: this.dependencies,
          audit: this.audit,
        });
      },
      longRunningWorkerOptions(redisOptionsFromUrl(this.env.REDIS_URL), { concurrency: 4 }),
    );
    this.worker.on("error", (error) => logWorkerError(this.logger, error));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
