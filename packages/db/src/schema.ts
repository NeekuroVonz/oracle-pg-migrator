import type {
  DataCopyRunStatus,
  DataCopyTableStatus,
  DataMode,
  DeployObjectStatus,
  DeployRunStatus,
  MigrationReportDto,
  OracleObjectType,
  ReportGateStatus,
} from "@migrator/shared";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const connectionRoleEnum = pgEnum("connection_role", ["SOURCE", "TARGET"]);
export const dbEngineEnum = pgEnum("db_engine", ["ORACLE", "POSTGRESQL"]);
export const accessModeEnum = pgEnum("access_mode", ["READ_ONLY", "READ_WRITE"]);
export const oracleConnectTypeEnum = pgEnum("oracle_connect_type", ["SID", "SERVICE_NAME", "TNS"]);
export const pgSslModeEnum = pgEnum("pg_ssl_mode", [
  "disable",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    ...timestamps,
  },
  (table) => [uniqueIndex("projects_name_uidx").on(table.name)],
);

export const databaseConnections = pgTable(
  "database_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: connectionRoleEnum("role").notNull(),
    engine: dbEngineEnum("engine").notNull(),
    accessMode: accessModeEnum("access_mode").notNull(),
    allowWrite: boolean("allow_write").notNull().default(false),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    host: varchar("host", { length: 512 }),
    port: integer("port"),
    username: varchar("username", { length: 256 }).notNull(),
    passwordCiphertext: text("password_ciphertext").notNull(),
    oracleConnectType: oracleConnectTypeEnum("oracle_connect_type"),
    oracleSid: varchar("oracle_sid", { length: 128 }),
    oracleServiceName: varchar("oracle_service_name", { length: 256 }),
    oracleTns: text("oracle_tns"),
    oracleSchemas: jsonb("oracle_schemas").$type<string[]>().notNull().default([]),
    oracleVersionOverride: varchar("oracle_version_override", { length: 64 }),
    connectionTimeoutMs: integer("connection_timeout_ms").notNull().default(15000),
    databaseName: varchar("database_name", { length: 256 }),
    schemaName: varchar("schema_name", { length: 256 }),
    sslMode: pgSslModeEnum("ssl_mode"),
    postgresVersion: varchar("postgres_version", { length: 32 }),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestStatus: varchar("last_test_status", { length: 32 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("database_connections_project_role_uidx").on(table.projectId, table.role),
    index("database_connections_project_idx").on(table.projectId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_project_idx").on(table.projectId),
    index("audit_logs_created_idx").on(table.createdAt),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ConnectionRow = typeof databaseConnections.$inferSelect;
export type NewConnectionRow = typeof databaseConnections.$inferInsert;
export type AuditLogRow = typeof auditLogs.$inferSelect;

export const discoveryRunStatusEnum = pgEnum("discovery_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const oracleObjectTypeEnum = pgEnum("oracle_object_type", [
  "TABLE",
  "VIEW",
  "MATERIALIZED_VIEW",
  "SEQUENCE",
  "INDEX",
  "CONSTRAINT",
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "PACKAGE",
  "PACKAGE_BODY",
  "TYPE",
  "TYPE_BODY",
  "SYNONYM",
  "DATABASE_LINK",
  "SCHEDULER_JOB",
]);

export const discoveryRuns = pgTable(
  "discovery_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => databaseConnections.id, { onDelete: "cascade" }),
    status: discoveryRunStatusEnum("status").notNull(),
    schemas: jsonb("schemas").$type<string[]>().notNull().default([]),
    objectCount: integer("object_count").notNull().default(0),
    extractedCount: integer("extracted_count").notNull().default(0),
    skippedUnchangedCount: integer("skipped_unchanged_count").notNull().default(0),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("discovery_runs_project_idx").on(table.projectId)],
);

export const discoveredObjects = pgTable(
  "discovered_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lastSeenRunId: uuid("last_seen_run_id").references(() => discoveryRuns.id, {
      onDelete: "set null",
    }),
    owner: varchar("owner", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    objectType: oracleObjectTypeEnum("object_type").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("DISCOVERED"),
    sourceText: text("source_text"),
    sourceHash: varchar("source_hash", { length: 64 }),
    estimatedRowCount: bigint("estimated_row_count", { mode: "number" }),
    byteSize: bigint("byte_size", { mode: "number" }),
    lastDdlTime: timestamp("last_ddl_time", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    targetSchema: varchar("target_schema", { length: 128 }),
    targetName: varchar("target_name", { length: 256 }),
    targetSql: text("target_sql"),
    riskLevel: varchar("risk_level", { length: 16 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    compileStatus: varchar("compile_status", { length: 16 }),
    compileError: text("compile_error"),
    testStatus: varchar("test_status", { length: 16 }),
    testError: text("test_error"),
    lastConversionRunId: uuid("last_conversion_run_id"),
    targetState: varchar("target_state", { length: 32 }),
    reconcileAction: varchar("reconcile_action", { length: 32 }),
    previousDesiredShapeHash: varchar("previous_desired_shape_hash", { length: 64 }),
    desiredShapeHash: varchar("desired_shape_hash", { length: 64 }),
    previousTargetShapeHash: varchar("previous_target_shape_hash", { length: 64 }),
    targetShapeHash: varchar("target_shape_hash", { length: 64 }),
    reconcileSql: text("reconcile_sql"),
    reconcileDiff: jsonb("reconcile_diff").$type<Record<string, unknown> | null>(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("discovered_objects_natural_uidx").on(
      table.projectId,
      table.owner,
      table.name,
      table.objectType,
    ),
    index("discovered_objects_project_type_idx").on(table.projectId, table.objectType),
    index("discovered_objects_project_owner_idx").on(table.projectId, table.owner),
    index("discovered_objects_run_idx").on(table.lastSeenRunId),
  ],
);

export const objectDependencies = pgTable(
  "object_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    discoveryRunId: uuid("discovery_run_id").references(() => discoveryRuns.id, {
      onDelete: "set null",
    }),
    fromObjectId: uuid("from_object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    toObjectId: uuid("to_object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    dependencyType: varchar("dependency_type", { length: 32 }).notNull().default("HARD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("object_dependencies_edge_uidx").on(
      table.fromObjectId,
      table.toObjectId,
      table.dependencyType,
    ),
    index("object_dependencies_project_idx").on(table.projectId),
  ],
);

export const dataModeEnum = pgEnum("data_mode", ["NONE", "SELECTED_TABLES", "ALL_SELECTED_TABLES"]);

export const migrationScopes = pgTable(
  "migration_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    includeSchemas: jsonb("include_schemas").$type<string[]>().notNull().default([]),
    includeObjectTypes: jsonb("include_object_types")
      .$type<OracleObjectType[]>()
      .notNull()
      .default([]),
    includeNamePatterns: jsonb("include_name_patterns").$type<string[]>().notNull().default([]),
    excludeNamePatterns: jsonb("exclude_name_patterns").$type<string[]>().notNull().default([]),
    excludeObjects: jsonb("exclude_objects").$type<string[]>().notNull().default([]),
    dataMode: dataModeEnum("data_mode").$type<DataMode>().notNull().default("NONE"),
    selectedTables: jsonb("selected_tables").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (table) => [uniqueIndex("migration_scopes_project_uidx").on(table.projectId)],
);

export type DiscoveryRunRow = typeof discoveryRuns.$inferSelect;
export type NewDiscoveryRunRow = typeof discoveryRuns.$inferInsert;
export type DiscoveredObjectRow = typeof discoveredObjects.$inferSelect;
export type NewDiscoveredObjectRow = typeof discoveredObjects.$inferInsert;
export type ObjectDependencyRow = typeof objectDependencies.$inferSelect;
export type MigrationScopeRow = typeof migrationScopes.$inferSelect;
export type NewMigrationScopeRow = typeof migrationScopes.$inferInsert;

export const migrationRunStatusEnum = pgEnum("migration_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const conversionAttemptStatusEnum = pgEnum("conversion_attempt_status", [
  "SUCCEEDED",
  "FAILED",
  "REVIEW_REQUIRED",
]);

export const converterTypeEnum = pgEnum("converter_type", ["RULES", "ORA2PG", "AI"]);

export const validationAttemptStatusEnum = pgEnum("validation_attempt_status", [
  "PASSED",
  "FAILED",
]);

export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: migrationRunStatusEnum("status").notNull(),
    strategy: varchar("strategy", { length: 32 }).notNull().default("FAST"),
    mappingRulesVersion: varchar("mapping_rules_version", { length: 64 }).notNull(),
    objectCount: integer("object_count").notNull().default(0),
    convertedCount: integer("converted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    reviewRequiredCount: integer("review_required_count").notNull().default(0),
    deferredCount: integer("deferred_count").notNull().default(0),
    waitingDependencyCount: integer("waiting_dependency_count").notNull().default(0),
    compiledCount: integer("compiled_count").notNull().default(0),
    compileFailedCount: integer("compile_failed_count").notNull().default(0),
    testedCount: integer("tested_count").notNull().default(0),
    testFailedCount: integer("test_failed_count").notNull().default(0),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("migration_runs_project_idx").on(table.projectId)],
);

export const migrationRunObjects = pgTable(
  "migration_run_objects",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    deferred: boolean("deferred").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("migration_run_objects_pk").on(table.runId, table.objectId),
    index("migration_run_objects_object_idx").on(table.objectId),
  ],
);

export const conversionAttempts = pgTable(
  "conversion_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    converterType: converterTypeEnum("converter_type").notNull(),
    mappingRulesVersion: varchar("mapping_rules_version", { length: 64 }).notNull(),
    sourceHash: varchar("source_hash", { length: 64 }),
    generatedSql: text("generated_sql"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
    status: conversionAttemptStatusEnum("status").notNull(),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversion_attempts_run_idx").on(table.runId),
    index("conversion_attempts_object_idx").on(table.objectId),
  ],
);

export const validationAttempts = pgTable(
  "validation_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    generatedSql: text("generated_sql"),
    status: validationAttemptStatusEnum("status").notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("validation_attempts_run_idx").on(table.runId),
    index("validation_attempts_object_idx").on(table.objectId),
  ],
);

export const testAttempts = pgTable(
  "test_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("test_attempts_run_idx").on(table.runId),
    index("test_attempts_object_idx").on(table.objectId),
  ],
);

export type MigrationRunRow = typeof migrationRuns.$inferSelect;
export type NewMigrationRunRow = typeof migrationRuns.$inferInsert;
export type ConversionAttemptRow = typeof conversionAttempts.$inferSelect;
export type NewConversionAttemptRow = typeof conversionAttempts.$inferInsert;
export type ValidationAttemptRow = typeof validationAttempts.$inferSelect;
export type NewValidationAttemptRow = typeof validationAttempts.$inferInsert;
export type TestAttemptRow = typeof testAttempts.$inferSelect;
export type NewTestAttemptRow = typeof testAttempts.$inferInsert;

export const reportGateStatusEnum = pgEnum("report_gate_status", [
  "IN_PROGRESS",
  "BLOCKED",
  "READY_FOR_DEPLOYMENT",
]);

export const migrationReports = pgTable(
  "migration_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    gateStatus: reportGateStatusEnum("gate_status").notNull(),
    readinessPercent: integer("readiness_percent").notNull().default(0),
    payload: jsonb("payload").$type<MigrationReportDto>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("migration_reports_run_uidx").on(table.runId),
    index("migration_reports_project_idx").on(table.projectId),
  ],
);

export type MigrationReportRow = typeof migrationReports.$inferSelect;
export type NewMigrationReportRow = typeof migrationReports.$inferInsert;

export const aiProviderKindEnum = pgEnum("ai_provider_kind", [
  "openai",
  "anthropic",
  "gemini",
  "cursor",
  "openai_compatible",
]);

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 200 }).notNull(),
    kind: aiProviderKindEnum("kind").notNull(),
    baseUrl: varchar("base_url", { length: 512 }),
    model: varchar("model", { length: 200 }).notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    roleConvert: boolean("role_convert").notNull().default(true),
    roleFix: boolean("role_fix").notNull().default(true),
    roleVerify: boolean("role_verify").notNull().default(true),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestStatus: varchar("last_test_status", { length: 32 }),
    ...timestamps,
  },
  (table) => [uniqueIndex("ai_providers_name_uidx").on(table.name)],
);

export type AiProviderRow = typeof aiProviders.$inferSelect;
export type NewAiProviderRow = typeof aiProviders.$inferInsert;

export const dataCopyRunStatusEnum = pgEnum("data_copy_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const dataCopyTableStatusEnum = pgEnum("data_copy_table_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const dataCopyRuns = pgTable(
  "data_copy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversionRunId: uuid("conversion_run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    status: dataCopyRunStatusEnum("status").$type<DataCopyRunStatus>().notNull(),
    dataMode: dataModeEnum("data_mode").$type<DataMode>().notNull(),
    chunkSize: integer("chunk_size").notNull().default(1000),
    tableCount: integer("table_count").notNull().default(0),
    copiedCount: integer("copied_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("data_copy_runs_project_idx").on(table.projectId),
    index("data_copy_runs_conversion_idx").on(table.conversionRunId),
  ],
);

export const dataCopyTables = pgTable(
  "data_copy_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    copyRunId: uuid("copy_run_id")
      .notNull()
      .references(() => dataCopyRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    owner: varchar("owner", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    targetSchema: varchar("target_schema", { length: 128 }).notNull(),
    targetName: varchar("target_name", { length: 256 }).notNull(),
    status: dataCopyTableStatusEnum("status").$type<DataCopyTableStatus>().notNull(),
    oracleRows: bigint("oracle_rows", { mode: "number" }),
    postgresRows: bigint("postgres_rows", { mode: "number" }),
    copiedRows: bigint("copied_rows", { mode: "number" }).notNull().default(0),
    lastOffset: bigint("last_offset", { mode: "number" }).notNull().default(0),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("data_copy_tables_run_idx").on(table.copyRunId),
    index("data_copy_tables_object_idx").on(table.objectId),
  ],
);

export type DataCopyRunRow = typeof dataCopyRuns.$inferSelect;
export type NewDataCopyRunRow = typeof dataCopyRuns.$inferInsert;
export type DataCopyTableRow = typeof dataCopyTables.$inferSelect;
export type NewDataCopyTableRow = typeof dataCopyTables.$inferInsert;

export const deployRunStatusEnum = pgEnum("deploy_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const deployObjectStatusEnum = pgEnum("deploy_object_status", [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const deployRuns = pgTable(
  "deploy_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    conversionRunId: uuid("conversion_run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    status: deployRunStatusEnum("status").$type<DeployRunStatus>().notNull(),
    gateStatus: reportGateStatusEnum("gate_status").$type<ReportGateStatus>().notNull(),
    objectCount: integer("object_count").notNull().default(0),
    deployedCount: integer("deployed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("deploy_runs_project_idx").on(table.projectId),
    index("deploy_runs_conversion_idx").on(table.conversionRunId),
  ],
);

export const deployObjects = pgTable(
  "deploy_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deployRunId: uuid("deploy_run_id")
      .notNull()
      .references(() => deployRuns.id, { onDelete: "cascade" }),
    objectId: uuid("object_id")
      .notNull()
      .references(() => discoveredObjects.id, { onDelete: "cascade" }),
    owner: varchar("owner", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    objectType: varchar("object_type", { length: 32 }).$type<OracleObjectType>().notNull(),
    targetSchema: varchar("target_schema", { length: 128 }),
    targetName: varchar("target_name", { length: 256 }),
    sortIndex: integer("sort_index").notNull().default(0),
    sql: text("sql").notNull(),
    status: deployObjectStatusEnum("status").$type<DeployObjectStatus>().notNull(),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (table) => [
    index("deploy_objects_run_idx").on(table.deployRunId),
    index("deploy_objects_object_idx").on(table.objectId),
  ],
);

export type DeployRunRow = typeof deployRuns.$inferSelect;
export type NewDeployRunRow = typeof deployRuns.$inferInsert;
export type DeployObjectRow = typeof deployObjects.$inferSelect;
export type NewDeployObjectRow = typeof deployObjects.$inferInsert;
