import type { AppEnv, SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  ConnectionsRepository,
  DiscoveredObjectsRepository,
  DiscoveryRunsRepository,
  ObjectDependenciesRepository,
  ProjectsRepository,
  toDiscoveredObjectDto,
  toDiscoveredObjectSummaryDto,
  toDiscoveryRunDto,
  toObjectDependencyDto,
} from "@migrator/db";
import { OracleReadOnlyClient } from "@migrator/oracle";
import { createQueue, QUEUE_NAMES } from "@migrator/queue";
import {
  AppError,
  ConflictError,
  type DiscoveryJobData,
  type ListDiscoveredObjectsQuery,
  type StartDiscoveryInput,
  suggestedDiscoverySchemas,
} from "@migrator/shared";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class DiscoveryService implements OnModuleDestroy {
  private readonly queue: ReturnType<typeof createQueue<DiscoveryJobData>>;

  constructor(
    private readonly env: AppEnv,
    private readonly cipher: SecretCipher,
    private readonly projects: ProjectsRepository,
    private readonly connections: ConnectionsRepository,
    private readonly runs: DiscoveryRunsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly audit: AuditRepository,
  ) {
    this.queue = createQueue<DiscoveryJobData>(QUEUE_NAMES.discovery, env.REDIS_URL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  async listSchemas(projectId: string): Promise<{ schemas: string[]; suggested: string[] }> {
    const source = await this.sourceConnection(projectId);
    const configured = source.oracleSchemas ?? [];
    try {
      const client = this.clientFor(source);
      const catalog = await client.listSchemaCatalog();
      const suggested = suggestedDiscoverySchemas(configured, catalog.sessionUser);
      const schemas = [...new Set([...suggested, ...catalog.schemas])].sort();
      return { schemas, suggested };
    } catch {
      const suggested = suggestedDiscoverySchemas(configured, source.username);
      return { schemas: suggested, suggested };
    }
  }

  async start(projectId: string, input: StartDiscoveryInput) {
    const source = await this.sourceConnection(projectId);
    const active = await this.runs.findActiveByProject(projectId);
    if (active) {
      throw new ConflictError("A discovery run is already in progress for this project");
    }
    const run = await this.runs.create({
      projectId,
      connectionId: source.id,
      status: "QUEUED",
      schemas: input.schemas.map((schema) => schema.toUpperCase()),
    });
    try {
      await this.queue.add(
        "discover",
        {
          projectId,
          runId: run.id,
          connectionId: source.id,
          schemas: run.schemas,
        },
        { jobId: `discovery-${run.id}`, attempts: 1, removeOnComplete: 50, removeOnFail: 50 },
      );
    } catch (error) {
      await this.runs.update(run.id, {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message : "Failed to enqueue discovery",
        finishedAt: new Date(),
      });
      throw error;
    }
    await this.audit.append({
      projectId,
      action: "discovery.started",
      entityType: "discovery_run",
      entityId: run.id,
      metadata: { schemas: run.schemas },
    });
    return toDiscoveryRunDto(run);
  }

  async latest(projectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.latestByProject(projectId);
    return { run: run ? toDiscoveryRunDto(run) : null };
  }

  async inventory(projectId: string, query: ListDiscoveredObjectsQuery) {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.latestByProject(projectId);
    const runId = run && run.status !== "FAILED" ? run.id : undefined;
    const { rows, total } = await this.objects.list({
      projectId,
      runId,
      owner: query.owner,
      objectType: query.objectType,
      q: query.q,
      extracted: query.extracted,
      hasRows: query.hasRows,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    });
    const [totals, owners] = await Promise.all([
      this.objects.countByType(projectId, runId),
      this.objects.listOwners(projectId, runId),
    ]);
    return {
      run: run ? toDiscoveryRunDto(run) : null,
      totals,
      objects: rows.map(toDiscoveredObjectSummaryDto),
      owners,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getObject(projectId: string, objectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const row = await this.objects.getByIdOrThrow(objectId);
    if (row.projectId !== projectId) {
      throw new AppError("NOT_FOUND", "Discovered object not found", 404);
    }
    return toDiscoveredObjectDto(row);
  }

  async getObjectDependencies(projectId: string, objectId: string) {
    await this.getObject(projectId, objectId);
    const rows = await this.dependencies.listForObject(projectId, objectId);
    return rows.map(toObjectDependencyDto);
  }

  private async sourceConnection(projectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const connections = await this.connections.listByProject(projectId);
    const source = connections.find(
      (connection) => connection.role === "SOURCE" && connection.engine === "ORACLE",
    );
    if (!source) {
      throw new AppError("NOT_FOUND", "Configure a source Oracle connection first", 404);
    }
    return source;
  }

  private clientFor(source: Awaited<ReturnType<ConnectionsRepository["listByProject"]>>[number]) {
    return new OracleReadOnlyClient({
      displayName: source.displayName,
      host: source.host ?? undefined,
      port: source.port ?? 1521,
      connectType: source.oracleConnectType ?? "SERVICE_NAME",
      sid: source.oracleSid ?? undefined,
      serviceName: source.oracleServiceName ?? undefined,
      tns: source.oracleTns ?? undefined,
      username: source.username,
      password: this.cipher.decrypt(source.passwordCiphertext),
      schemas: source.oracleSchemas ?? [],
      connectionTimeoutMs: source.connectionTimeoutMs,
      statementTimeoutMs: this.env.ORACLE_STATEMENT_TIMEOUT_MS,
    });
  }
}
