import {
  type AiProviderDto,
  type CompileStatus,
  type ConnectionDto,
  type ConversionAttemptDto,
  type ConversionRunObjectDto,
  type DataCopyRunDto,
  type DataCopyTableDto,
  type DeployObjectDto,
  type DeployRunDto,
  type DiscoveredObjectDto,
  type DiscoveredObjectMetadata,
  type DiscoveredObjectSummaryDto,
  type DiscoveryRunDto,
  type MigrationReportDto,
  type MigrationRunDto,
  migrationReportDtoSchema,
  type ObjectDependencyDto,
  type ObjectStatus,
  type ProjectDto,
  type ReconcileAction,
  type RiskLevel,
  type ScopeDto,
  type TargetState,
  type TestAttemptDto,
  type TestAttemptStatus,
  type ValidationAttemptDto,
} from "@migrator/shared";
import type { ObjectDependencyListRow } from "./object-dependencies-repository";
import type {
  AiProviderRow,
  ConnectionRow,
  ConversionAttemptRow,
  DataCopyRunRow,
  DataCopyTableRow,
  DeployObjectRow,
  DeployRunRow,
  DiscoveredObjectRow,
  DiscoveryRunRow,
  MigrationReportRow,
  MigrationRunRow,
  MigrationScopeRow,
  ProjectRow,
  TestAttemptRow,
  ValidationAttemptRow,
} from "./schema";

export function toProjectDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAiProviderDto(row: AiProviderRow): AiProviderDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: row.apiKeyCiphertext.length > 0,
    enabled: row.enabled,
    roleConvert: row.roleConvert,
    roleFix: row.roleFix,
    roleVerify: row.roleVerify,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConnectionDto(row: ConnectionRow): ConnectionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    role: row.role,
    engine: row.engine,
    accessMode: row.accessMode,
    allowWrite: false,
    displayName: row.displayName,
    host: row.host,
    port: row.port,
    username: row.username,
    hasPassword: true,
    oracleConnectType: row.oracleConnectType,
    oracleSid: row.oracleSid,
    oracleServiceName: row.oracleServiceName,
    oracleTns: row.oracleTns,
    oracleSchemas: row.oracleSchemas ?? [],
    oracleVersionOverride: row.oracleVersionOverride,
    connectionTimeoutMs: row.connectionTimeoutMs,
    databaseName: row.databaseName,
    schemaName: row.schemaName,
    sslMode: row.sslMode,
    postgresVersion: row.postgresVersion,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDiscoveryRunDto(row: DiscoveryRunRow): DiscoveryRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    connectionId: row.connectionId,
    status: row.status,
    schemas: row.schemas ?? [],
    objectCount: row.objectCount,
    extractedCount: row.extractedCount,
    skippedUnchangedCount: row.skippedUnchangedCount,
    stats: row.stats ?? {},
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDiscoveredObjectDto(row: DiscoveredObjectRow): DiscoveredObjectDto {
  return {
    ...toDiscoveredObjectSummaryDto(row),
    sourceText: row.sourceText,
  };
}

export function toDiscoveredObjectSummaryDto(row: DiscoveredObjectRow): DiscoveredObjectSummaryDto {
  return {
    id: row.id,
    projectId: row.projectId,
    owner: row.owner,
    name: row.name,
    objectType: row.objectType,
    status: row.status as ObjectStatus,
    sourceHash: row.sourceHash,
    estimatedRowCount: row.estimatedRowCount,
    byteSize: row.byteSize,
    lastDdlTime: row.lastDdlTime?.toISOString() ?? null,
    metadata: (row.metadata ?? {}) as DiscoveredObjectMetadata,
    discoveredAt: row.discoveredAt.toISOString(),
    extractedAt: row.extractedAt?.toISOString() ?? null,
    lastSeenRunId: row.lastSeenRunId,
    targetSchema: row.targetSchema,
    targetName: row.targetName,
    targetSql: row.targetSql,
    riskLevel: (row.riskLevel as RiskLevel | null) ?? null,
    attemptCount: row.attemptCount,
    compileStatus: (row.compileStatus as CompileStatus | null) ?? null,
    compileError: row.compileError,
    testStatus: (row.testStatus as TestAttemptStatus | null) ?? null,
    testError: row.testError,
    targetState: (row.targetState as TargetState | null) ?? null,
    reconcileAction: (row.reconcileAction as ReconcileAction | null) ?? null,
    previousDesiredShapeHash: row.previousDesiredShapeHash,
    desiredShapeHash: row.desiredShapeHash,
    previousTargetShapeHash: row.previousTargetShapeHash,
    targetShapeHash: row.targetShapeHash,
    reconcileSql: row.reconcileSql,
    reconcileDiff: row.reconcileDiff ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMigrationRunDto(row: MigrationRunRow): MigrationRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    strategy: row.strategy as MigrationRunDto["strategy"],
    mappingRulesVersion: row.mappingRulesVersion,
    objectCount: row.objectCount,
    convertedCount: row.convertedCount,
    failedCount: row.failedCount,
    reviewRequiredCount: row.reviewRequiredCount,
    deferredCount: row.deferredCount,
    waitingDependencyCount: row.waitingDependencyCount,
    compiledCount: row.compiledCount,
    compileFailedCount: row.compileFailedCount,
    testedCount: row.testedCount,
    testFailedCount: row.testFailedCount,
    stats: row.stats ?? {},
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toConversionAttemptDto(row: ConversionAttemptRow): ConversionAttemptDto {
  return {
    id: row.id,
    runId: row.runId,
    objectId: row.objectId,
    attemptNumber: row.attemptNumber,
    converterType: row.converterType,
    mappingRulesVersion: row.mappingRulesVersion,
    sourceHash: row.sourceHash,
    generatedSql: row.generatedSql,
    warnings: row.warnings ?? [],
    riskFlags: row.riskFlags ?? [],
    status: row.status,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toValidationAttemptDto(row: ValidationAttemptRow): ValidationAttemptDto {
  return {
    id: row.id,
    runId: row.runId,
    objectId: row.objectId,
    attemptNumber: row.attemptNumber,
    generatedSql: row.generatedSql,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    details: row.details ?? {},
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTestAttemptDto(row: TestAttemptRow): TestAttemptDto {
  return {
    id: row.id,
    runId: row.runId,
    objectId: row.objectId,
    attemptNumber: row.attemptNumber,
    status: row.status as TestAttemptStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    details: row.details ?? {},
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toConversionRunObjectDto(row: DiscoveredObjectRow): ConversionRunObjectDto {
  const summary = toDiscoveredObjectSummaryDto(row);
  const { targetSql: _targetSql, reconcileSql: _reconcileSql, ...rest } = summary;
  return rest;
}

export function toObjectDependencyDto(row: ObjectDependencyListRow): ObjectDependencyDto {
  return {
    id: row.id,
    fromObjectId: row.fromObjectId,
    toObjectId: row.toObjectId,
    dependencyType: row.dependencyType,
    fromOwner: row.fromOwner,
    fromName: row.fromName,
    fromType: row.fromType,
    toOwner: row.toOwner,
    toName: row.toName,
    toType: row.toType,
  };
}

export function toScopeDto(row: MigrationScopeRow): ScopeDto {
  return {
    id: row.id,
    projectId: row.projectId,
    saved: true,
    includeSchemas: row.includeSchemas ?? [],
    includeObjectTypes: row.includeObjectTypes ?? [],
    includeNamePatterns: row.includeNamePatterns ?? [],
    excludeNamePatterns: row.excludeNamePatterns ?? [],
    excludeObjects: row.excludeObjects ?? [],
    dataMode: row.dataMode,
    selectedTables: row.selectedTables ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMigrationReportDto(row: MigrationReportRow): MigrationReportDto {
  return migrationReportDtoSchema.parse(row.payload);
}

export function toDataCopyTableDto(row: DataCopyTableRow): DataCopyTableDto {
  return {
    id: row.id,
    copyRunId: row.copyRunId,
    objectId: row.objectId,
    owner: row.owner,
    name: row.name,
    targetSchema: row.targetSchema,
    targetName: row.targetName,
    status: row.status,
    oracleRows: row.oracleRows,
    postgresRows: row.postgresRows,
    copiedRows: row.copiedRows,
    lastOffset: row.lastOffset,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDataCopyRunDto(
  row: DataCopyRunRow,
  tables: DataCopyTableRow[] = [],
): DataCopyRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conversionRunId: row.conversionRunId,
    status: row.status,
    dataMode: row.dataMode,
    chunkSize: row.chunkSize,
    tableCount: row.tableCount,
    copiedCount: row.copiedCount,
    failedCount: row.failedCount,
    matchedCount: row.matchedCount,
    errorMessage: row.errorMessage,
    cancelRequested: row.cancelRequested ?? false,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tables: tables.map(toDataCopyTableDto),
  };
}

export function toDeployObjectDto(row: DeployObjectRow): DeployObjectDto {
  return {
    id: row.id,
    deployRunId: row.deployRunId,
    objectId: row.objectId,
    owner: row.owner,
    name: row.name,
    objectType: row.objectType,
    targetSchema: row.targetSchema,
    targetName: row.targetName,
    sortIndex: row.sortIndex,
    status: row.status,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDeployRunDto(row: DeployRunRow, objects: DeployObjectRow[] = []): DeployRunDto {
  return {
    id: row.id,
    projectId: row.projectId,
    conversionRunId: row.conversionRunId,
    status: row.status,
    gateStatus: row.gateStatus,
    objectCount: row.objectCount,
    deployedCount: row.deployedCount,
    failedCount: row.failedCount,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    objects: objects.map(toDeployObjectDto),
  };
}
