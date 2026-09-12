import type { SecretCipher } from "@migrator/config";
import {
  AuditRepository,
  type ConnectionRow,
  ConnectionsRepository,
  ProjectsRepository,
  toConnectionDto,
} from "@migrator/db";
import { OracleReadOnlyClient } from "@migrator/oracle";
import { testPostgresConnection } from "@migrator/postgres";
import {
  AppError,
  type ConnectionDto,
  type ConnectionTestResult,
  type CreateOracleConnectionInput,
  type CreatePostgresConnectionInput,
  SOURCE_ORACLE_ACCESS,
  type UpdateOracleConnectionInput,
  type UpdatePostgresConnectionInput,
} from "@migrator/shared";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly connections: ConnectionsRepository,
    private readonly audit: AuditRepository,
    private readonly cipher: SecretCipher,
  ) {}

  async list(projectId: string): Promise<ConnectionDto[]> {
    await this.projects.getByIdOrThrow(projectId);
    const rows = await this.connections.listByProject(projectId);
    return rows.map(toConnectionDto);
  }

  async createOracle(
    projectId: string,
    input: CreateOracleConnectionInput,
  ): Promise<ConnectionDto> {
    await this.projects.getByIdOrThrow(projectId);
    const row = await this.connections.create({
      projectId,
      role: "SOURCE",
      engine: SOURCE_ORACLE_ACCESS.engine,
      accessMode: SOURCE_ORACLE_ACCESS.accessMode,
      allowWrite: SOURCE_ORACLE_ACCESS.allowWrite,
      displayName: input.displayName,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordCiphertext: this.cipher.encrypt(input.password),
      oracleConnectType: input.connectType,
      oracleSid: input.sid,
      oracleServiceName: input.serviceName,
      oracleTns: input.tns,
      oracleSchemas: input.schemas,
      oracleVersionOverride: input.oracleVersionOverride,
      connectionTimeoutMs: input.connectionTimeoutMs,
    });
    await this.audit.append({
      projectId,
      action: "connection.created",
      entityType: "database_connection",
      entityId: row.id,
      metadata: { role: "SOURCE", engine: "ORACLE", accessMode: "READ_ONLY" },
    });
    return toConnectionDto(row);
  }

  async createPostgres(
    projectId: string,
    input: CreatePostgresConnectionInput,
  ): Promise<ConnectionDto> {
    await this.projects.getByIdOrThrow(projectId);
    const row = await this.connections.create({
      projectId,
      role: "TARGET",
      engine: "POSTGRESQL",
      accessMode: "READ_WRITE",
      allowWrite: false,
      displayName: input.displayName,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordCiphertext: this.cipher.encrypt(input.password),
      databaseName: input.database,
      schemaName: input.schema,
      sslMode: input.sslMode,
      postgresVersion: input.postgresVersion,
      connectionTimeoutMs: input.connectionTimeoutMs,
      oracleSchemas: [],
    });
    await this.audit.append({
      projectId,
      action: "connection.created",
      entityType: "database_connection",
      entityId: row.id,
      metadata: { role: "TARGET", engine: "POSTGRESQL" },
    });
    return toConnectionDto(row);
  }

  async updateOracle(
    projectId: string,
    connectionId: string,
    input: UpdateOracleConnectionInput,
  ): Promise<ConnectionDto> {
    const existing = await this.requireOwned(projectId, connectionId, "SOURCE");
    const row = await this.connections.update(connectionId, {
      displayName: input.displayName,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordCiphertext: input.password
        ? this.cipher.encrypt(input.password)
        : existing.passwordCiphertext,
      oracleConnectType: input.connectType,
      oracleSid: input.sid,
      oracleServiceName: input.serviceName,
      oracleTns: input.tns,
      oracleSchemas: input.schemas,
      oracleVersionOverride: input.oracleVersionOverride,
      connectionTimeoutMs: input.connectionTimeoutMs,
      accessMode: "READ_ONLY",
      allowWrite: false,
      engine: "ORACLE",
      role: "SOURCE",
    });
    await this.audit.append({
      projectId,
      action: "connection.updated",
      entityType: "database_connection",
      entityId: row.id,
      metadata: { role: "SOURCE" },
    });
    return toConnectionDto(row);
  }

  async updatePostgres(
    projectId: string,
    connectionId: string,
    input: UpdatePostgresConnectionInput,
  ): Promise<ConnectionDto> {
    const existing = await this.requireOwned(projectId, connectionId, "TARGET");
    const row = await this.connections.update(connectionId, {
      displayName: input.displayName,
      host: input.host,
      port: input.port,
      username: input.username,
      passwordCiphertext: input.password
        ? this.cipher.encrypt(input.password)
        : existing.passwordCiphertext,
      databaseName: input.database,
      schemaName: input.schema,
      sslMode: input.sslMode,
      postgresVersion: input.postgresVersion,
      connectionTimeoutMs: input.connectionTimeoutMs,
      allowWrite: false,
    });
    await this.audit.append({
      projectId,
      action: "connection.updated",
      entityType: "database_connection",
      entityId: row.id,
      metadata: { role: "TARGET" },
    });
    return toConnectionDto(row);
  }

  async delete(projectId: string, connectionId: string): Promise<void> {
    await this.requireOwned(projectId, connectionId);
    await this.connections.delete(connectionId);
    await this.audit.append({
      projectId,
      action: "connection.deleted",
      entityType: "database_connection",
      entityId: connectionId,
    });
  }

  async test(projectId: string, connectionId: string): Promise<ConnectionTestResult> {
    const row = await this.requireOwned(projectId, connectionId);
    const password = this.cipher.decrypt(row.passwordCiphertext);
    let result: ConnectionTestResult;
    if (row.engine === "ORACLE") {
      const client = new OracleReadOnlyClient({
        displayName: row.displayName,
        host: row.host ?? undefined,
        port: row.port ?? 1521,
        connectType: row.oracleConnectType ?? "SERVICE_NAME",
        sid: row.oracleSid ?? undefined,
        serviceName: row.oracleServiceName ?? undefined,
        tns: row.oracleTns ?? undefined,
        username: row.username,
        password,
        schemas: row.oracleSchemas ?? [],
        connectionTimeoutMs: row.connectionTimeoutMs,
        statementTimeoutMs: row.connectionTimeoutMs,
      });
      result = await client.testConnection();
    } else if (row.engine === "POSTGRESQL") {
      result = await testPostgresConnection({
        host: row.host ?? "localhost",
        port: row.port ?? 5432,
        database: row.databaseName ?? "postgres",
        username: row.username,
        password,
        sslMode: row.sslMode ?? "prefer",
        connectionTimeoutMs: row.connectionTimeoutMs,
      });
    } else {
      const exhaustive: never = row.engine;
      throw new AppError("UNSUPPORTED_ENGINE", `Unsupported engine: ${String(exhaustive)}`);
    }

    await this.connections.update(connectionId, {
      lastTestedAt: new Date(),
      lastTestStatus: result.ok ? "OK" : "FAILED",
    });
    await this.audit.append({
      projectId,
      action: "connection.tested",
      entityType: "database_connection",
      entityId: connectionId,
      metadata: {
        engine: row.engine,
        ok: result.ok,
        accessMode: result.accessMode,
        writePrivileges: result.privilegeStatus?.writePrivileges,
      },
    });
    return result;
  }

  private async requireOwned(
    projectId: string,
    connectionId: string,
    role?: "SOURCE" | "TARGET",
  ): Promise<ConnectionRow> {
    await this.projects.getByIdOrThrow(projectId);
    const row = await this.connections.getByIdOrThrow(connectionId);
    if (row.projectId !== projectId) {
      throw new AppError("NOT_FOUND", "Connection not found", 404);
    }
    if (role && row.role !== role) {
      throw new AppError("VALIDATION_ERROR", `Connection is not a ${role} connection`, 422);
    }
    return row;
  }
}
