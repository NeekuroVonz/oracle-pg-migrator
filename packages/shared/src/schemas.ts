import { z } from "zod";
import {
  AI_PROVIDER_KINDS,
  COMPILE_STATUSES,
  CONVERSION_ATTEMPT_STATUSES,
  CONVERTER_TYPES,
  DAG_BLOCKED_REASONS,
  DATA_COPY_CHUNK_SIZE_MAX,
  DATA_COPY_RUN_STATUSES,
  DATA_COPY_TABLE_STATUSES,
  DATA_MODES,
  DEPLOY_OBJECT_STATUSES,
  DEPLOY_RUN_STATUSES,
  DISCOVERY_RUN_STATUSES,
  MIGRATION_RUN_STATUSES,
  MIGRATION_STRATEGIES,
  OBJECT_STATUSES,
  ORACLE_CONNECT_TYPES,
  ORACLE_OBJECT_TYPES,
  PG_SSL_MODES,
  RECONCILE_ACTIONS,
  REPORT_GATE_STATUSES,
  RISK_LEVELS,
  SCOPE_EXCLUSION_REASONS,
  TARGET_STATES,
  TEST_ATTEMPT_STATUSES,
  VALIDATION_ATTEMPT_STATUSES,
  VALIDATOR_MODES,
  VALIDATOR_SLOT_STATUSES,
} from "./enums";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const DISCOVERED_OBJECT_SORT_FIELDS = [
  "owner",
  "name",
  "objectType",
  "estimatedRowCount",
  "byteSize",
  "lastDdlTime",
  "extracted",
] as const;

export type DiscoveredObjectSortField = (typeof DISCOVERED_OBJECT_SORT_FIELDS)[number];

export const listDiscoveredObjectsQuerySchema = paginationQuerySchema.extend({
  owner: z.string().trim().min(1).max(128).optional(),
  objectType: z.enum(ORACLE_OBJECT_TYPES).optional(),
  q: z.string().trim().min(1).max(256).optional(),
  extracted: z.enum(["yes", "no"]).optional(),
  hasRows: z.enum(["yes", "no"]).optional(),
  sortBy: z.enum(DISCOVERED_OBJECT_SORT_FIELDS).default("owner"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export type ListDiscoveredObjectsQuery = z.infer<typeof listDiscoveredObjectsQuerySchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProjectDto = z.infer<typeof projectDtoSchema>;

const oracleConnectFields = {
  displayName: z.string().trim().min(1).max(200),
  host: z.string().trim().min(1).max(512).optional(),
  port: z.number().int().min(1).max(65535).default(1521),
  connectType: z.enum(ORACLE_CONNECT_TYPES),
  sid: z.string().trim().min(1).max(128).optional(),
  serviceName: z.string().trim().min(1).max(256).optional(),
  tns: z.string().trim().min(1).max(8000).optional(),
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(1024),
  schemas: z.array(z.string().trim().min(1).max(128)).max(500).default([]),
  connectionTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
  oracleVersionOverride: z.string().trim().min(1).max(64).optional(),
};

function refineOracleConnect(
  value: {
    connectType: (typeof ORACLE_CONNECT_TYPES)[number];
    host?: string;
    sid?: string;
    serviceName?: string;
    tns?: string;
  },
  ctx: z.RefinementCtx,
) {
  switch (value.connectType) {
    case "SID":
      if (!value.host) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "host is required for SID",
          path: ["host"],
        });
      }
      if (!value.sid) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sid is required", path: ["sid"] });
      }
      break;
    case "SERVICE_NAME":
      if (!value.host) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "host is required for SERVICE_NAME",
          path: ["host"],
        });
      }
      if (!value.serviceName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "serviceName is required",
          path: ["serviceName"],
        });
      }
      break;
    case "TNS":
      if (!value.tns) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tns is required", path: ["tns"] });
      }
      break;
    default: {
      const exhaustive: never = value.connectType;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unsupported connect type: ${String(exhaustive)}`,
      });
    }
  }
}

export const createOracleConnectionSchema = z
  .object(oracleConnectFields)
  .strict()
  .superRefine((value, ctx) => refineOracleConnect(value, ctx));

export const updateOracleConnectionSchema = z
  .object({
    ...oracleConnectFields,
    password: z.string().min(1).max(1024).optional(),
  })
  .partial()
  .extend({
    connectType: z.enum(ORACLE_CONNECT_TYPES).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.connectType) {
      refineOracleConnect(
        {
          connectType: value.connectType,
          host: value.host,
          sid: value.sid,
          serviceName: value.serviceName,
          tns: value.tns,
        },
        ctx,
      );
    }
  });

export const createPostgresConnectionSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    host: z.string().trim().min(1).max(512),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1).max(256),
    schema: z.string().trim().min(1).max(256).default("public"),
    username: z.string().trim().min(1).max(256),
    password: z.string().min(1).max(1024),
    sslMode: z.enum(PG_SSL_MODES).default("prefer"),
    postgresVersion: z.string().trim().min(1).max(32).optional(),
    connectionTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
  })
  .strict();

export const updatePostgresConnectionSchema = createPostgresConnectionSchema.partial();

export type CreateOracleConnectionInput = z.infer<typeof createOracleConnectionSchema>;
export type UpdateOracleConnectionInput = z.infer<typeof updateOracleConnectionSchema>;
export type CreatePostgresConnectionInput = z.infer<typeof createPostgresConnectionSchema>;
export type UpdatePostgresConnectionInput = z.infer<typeof updatePostgresConnectionSchema>;

export const connectionDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  role: z.enum(["SOURCE", "TARGET"]),
  engine: z.enum(["ORACLE", "POSTGRESQL"]),
  accessMode: z.enum(["READ_ONLY", "READ_WRITE"]),
  allowWrite: z.literal(false).or(z.boolean()),
  displayName: z.string(),
  host: z.string().nullable(),
  port: z.number().nullable(),
  username: z.string(),
  hasPassword: z.literal(true),
  oracleConnectType: z.enum(ORACLE_CONNECT_TYPES).nullable(),
  oracleSid: z.string().nullable(),
  oracleServiceName: z.string().nullable(),
  oracleTns: z.string().nullable(),
  oracleSchemas: z.array(z.string()),
  oracleVersionOverride: z.string().nullable(),
  connectionTimeoutMs: z.number(),
  databaseName: z.string().nullable(),
  schemaName: z.string().nullable(),
  sslMode: z.enum(PG_SSL_MODES).nullable(),
  postgresVersion: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ConnectionDto = z.infer<typeof connectionDtoSchema>;

export const oraclePrivilegeStatusSchema = z.object({
  readPrivileges: z.boolean(),
  writePrivileges: z.enum(["DETECTED", "NOT_DETECTED"]),
  privileges: z.array(z.string()),
  warning: z.string().nullable(),
});

export type OraclePrivilegeStatus = z.infer<typeof oraclePrivilegeStatusSchema>;

export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  engine: z.enum(["ORACLE", "POSTGRESQL"]),
  accessMode: z.enum(["READ_ONLY", "READ_WRITE"]).optional(),
  serverVersion: z.string().nullable(),
  latencyMs: z.number(),
  message: z.string(),
  privilegeStatus: oraclePrivilegeStatusSchema.optional(),
});

export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const auditLogDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;

export const startDiscoverySchema = z
  .object({
    schemas: z.array(z.string().trim().min(1).max(128)).min(1).max(500),
  })
  .strict();

export type StartDiscoveryInput = z.infer<typeof startDiscoverySchema>;

export const discoveredColumnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  dataLength: z.number().nullable(),
  dataPrecision: z.number().nullable(),
  dataScale: z.number().nullable(),
  columnId: z.number().nullable(),
});

export type DiscoveredColumn = z.infer<typeof discoveredColumnSchema>;

export const discoveredObjectMetadataSchema = z.object({
  columns: z.array(discoveredColumnSchema).optional(),
  partitions: z.array(z.object({ name: z.string(), position: z.number().nullable() })).optional(),
  constraintType: z.string().optional(),
  tableName: z.string().optional(),
  uniqueness: z.string().optional(),
  indexType: z.string().optional(),
  searchCondition: z.string().optional(),
  referencedOwner: z.string().optional(),
  referencedName: z.string().optional(),
  deleteRule: z.string().optional(),
  enabled: z.boolean().optional(),
  extractError: z.string().nullable().optional(),
  oracleStatus: z.string().optional(),
});

export type DiscoveredObjectMetadata = z.infer<typeof discoveredObjectMetadataSchema>;

export const discoveryRunDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  connectionId: z.string().uuid(),
  status: z.enum(DISCOVERY_RUN_STATUSES),
  schemas: z.array(z.string()),
  objectCount: z.number(),
  extractedCount: z.number(),
  skippedUnchangedCount: z.number(),
  stats: z.record(z.unknown()),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DiscoveryRunDto = z.infer<typeof discoveryRunDtoSchema>;

export const discoveredObjectDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  objectType: z.enum(ORACLE_OBJECT_TYPES),
  status: z.enum(OBJECT_STATUSES),
  sourceText: z.string().nullable(),
  sourceHash: z.string().nullable(),
  estimatedRowCount: z.number().nullable(),
  byteSize: z.number().nullable(),
  lastDdlTime: z.string().nullable(),
  metadata: discoveredObjectMetadataSchema,
  discoveredAt: z.string(),
  extractedAt: z.string().nullable(),
  lastSeenRunId: z.string().uuid().nullable(),
  targetSchema: z.string().nullable(),
  targetName: z.string().nullable(),
  targetSql: z.string().nullable(),
  riskLevel: z.enum(RISK_LEVELS).nullable(),
  attemptCount: z.number(),
  compileStatus: z.enum(COMPILE_STATUSES).nullable(),
  compileError: z.string().nullable(),
  testStatus: z.enum(TEST_ATTEMPT_STATUSES).nullable(),
  testError: z.string().nullable(),
  targetState: z.enum(TARGET_STATES).nullable(),
  reconcileAction: z.enum(RECONCILE_ACTIONS).nullable(),
  previousDesiredShapeHash: z.string().nullable(),
  desiredShapeHash: z.string().nullable(),
  previousTargetShapeHash: z.string().nullable(),
  targetShapeHash: z.string().nullable(),
  reconcileSql: z.string().nullable(),
  reconcileDiff: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DiscoveredObjectDto = z.infer<typeof discoveredObjectDtoSchema>;

export const discoveredObjectSummaryDtoSchema = discoveredObjectDtoSchema.omit({
  sourceText: true,
});

export type DiscoveredObjectSummaryDto = z.infer<typeof discoveredObjectSummaryDtoSchema>;

export const discoveryInventoryDtoSchema = z.object({
  run: discoveryRunDtoSchema.nullable(),
  totals: z.record(z.number()),
  objects: z.array(discoveredObjectSummaryDtoSchema),
  owners: z.array(z.string()),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export type DiscoveryInventoryDto = z.infer<typeof discoveryInventoryDtoSchema>;

export const objectDependencyDtoSchema = z.object({
  id: z.string().uuid(),
  fromObjectId: z.string().uuid(),
  toObjectId: z.string().uuid(),
  dependencyType: z.string(),
  fromOwner: z.string(),
  fromName: z.string(),
  fromType: z.enum(ORACLE_OBJECT_TYPES),
  toOwner: z.string(),
  toName: z.string(),
  toType: z.enum(ORACLE_OBJECT_TYPES),
});

export type ObjectDependencyDto = z.infer<typeof objectDependencyDtoSchema>;

export const dagBlockedByDtoSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  objectType: z.enum(ORACLE_OBJECT_TYPES),
  reason: z.enum(DAG_BLOCKED_REASONS),
});

export const objectDagNodeDtoSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  objectType: z.enum(ORACLE_OBJECT_TYPES),
  layer: z.number(),
  waiting: z.boolean(),
  inCycle: z.boolean(),
  blockedBy: z.array(dagBlockedByDtoSchema),
});

export const objectDagDtoSchema = z.object({
  nodeCount: z.number(),
  edgeCount: z.number(),
  layerCount: z.number(),
  cycleCount: z.number(),
  waitingCount: z.number(),
  layers: z.array(z.array(z.string().uuid())),
  cycles: z.array(z.array(z.string().uuid())),
  nodes: z.array(objectDagNodeDtoSchema),
  edges: z.array(
    z.object({
      fromObjectId: z.string().uuid(),
      toObjectId: z.string().uuid(),
      dependencyType: z.string(),
    }),
  ),
});

export type ObjectDagDto = z.infer<typeof objectDagDtoSchema>;
export type ObjectDagNodeDto = z.infer<typeof objectDagNodeDtoSchema>;

export const objectDagQuerySchema = z.object({
  strategy: z.enum(MIGRATION_STRATEGIES).optional(),
});

export type ObjectDagQuery = z.infer<typeof objectDagQuerySchema>;

export type DiscoveryJobData = {
  projectId: string;
  runId: string;
  connectionId: string;
  schemas: string[];
};

export const SCOPE_NAME_PATTERN_MAX = 20_000;
export const SCOPE_NAME_PATTERN_LENGTH_MAX = 400;
export const SCOPE_OBJECT_REF_MAX = 20_000;

export const upsertScopeSchema = z
  .object({
    includeSchemas: z.array(z.string().trim().min(1).max(128)).max(500),
    includeObjectTypes: z.array(z.enum(ORACLE_OBJECT_TYPES)).max(ORACLE_OBJECT_TYPES.length),
    includeNamePatterns: z
      .array(z.string().trim().min(1).max(SCOPE_NAME_PATTERN_LENGTH_MAX))
      .max(SCOPE_NAME_PATTERN_MAX),
    excludeNamePatterns: z
      .array(z.string().trim().min(1).max(SCOPE_NAME_PATTERN_LENGTH_MAX))
      .max(SCOPE_NAME_PATTERN_MAX),
    excludeObjects: z
      .array(z.string().trim().min(1).max(SCOPE_NAME_PATTERN_LENGTH_MAX))
      .max(SCOPE_OBJECT_REF_MAX),
    dataMode: z.enum(DATA_MODES),
    selectedTables: z
      .array(z.string().trim().min(1).max(SCOPE_NAME_PATTERN_LENGTH_MAX))
      .max(SCOPE_OBJECT_REF_MAX),
  })
  .strict();

export type UpsertScopeInput = z.infer<typeof upsertScopeSchema>;

export const scopePreviewQuerySchema = paginationQuerySchema.extend({
  objectType: z.enum(ORACLE_OBJECT_TYPES).optional(),
  inclusion: z.enum(["included", "excluded", "all"]).default("included"),
  q: z.string().trim().min(1).max(256).optional(),
});

export type ScopePreviewQuery = z.infer<typeof scopePreviewQuerySchema>;

export const scopeDtoSchema = upsertScopeSchema.extend({
  id: z.string().uuid().nullable(),
  projectId: z.string().uuid(),
  saved: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export type ScopeDto = z.infer<typeof scopeDtoSchema>;

export const scopeTypeCountSchema = z.object({
  found: z.number(),
  selected: z.number(),
  excluded: z.number(),
});

export type ScopeTypeCount = z.infer<typeof scopeTypeCountSchema>;

export const scopePreviewObjectSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  objectType: z.enum(ORACLE_OBJECT_TYPES),
  included: z.boolean(),
  reason: z.enum(SCOPE_EXCLUSION_REASONS).nullable(),
});

export type ScopePreviewObject = z.infer<typeof scopePreviewObjectSchema>;

export const scopePreviewDtoSchema = z.object({
  scope: scopeDtoSchema,
  totals: scopeTypeCountSchema,
  byType: z.record(scopeTypeCountSchema),
  data: z.object({
    mode: z.enum(DATA_MODES),
    selectedTableCount: z.number(),
    tables: z.array(
      z.object({
        id: z.string().uuid(),
        owner: z.string(),
        name: z.string(),
      }),
    ),
  }),
  objects: z.array(scopePreviewObjectSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  discoveredSchemas: z.array(z.string()),
  objectCount: z.number(),
});

export type ScopePreviewDto = z.infer<typeof scopePreviewDtoSchema>;

export const startConversionSchema = z
  .object({
    strategy: z.enum(MIGRATION_STRATEGIES).default("FAST"),
  })
  .strict();

export type StartConversionInput = z.infer<typeof startConversionSchema>;

export const migrationRunDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: z.enum(MIGRATION_RUN_STATUSES),
  strategy: z.enum(MIGRATION_STRATEGIES),
  mappingRulesVersion: z.string(),
  objectCount: z.number(),
  convertedCount: z.number(),
  failedCount: z.number(),
  reviewRequiredCount: z.number(),
  deferredCount: z.number(),
  waitingDependencyCount: z.number(),
  compiledCount: z.number(),
  compileFailedCount: z.number(),
  testedCount: z.number(),
  testFailedCount: z.number(),
  stats: z.record(z.unknown()),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MigrationRunDto = z.infer<typeof migrationRunDtoSchema>;

export const reportBlockingItemDtoSchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  objectType: z.string(),
  status: z.enum(OBJECT_STATUSES),
  detail: z.string(),
});

export const readinessBreakdownDtoSchema = z.object({
  schemaPercent: z.number().nullable(),
  dataPercent: z.number().nullable(),
  compilePercent: z.number().nullable(),
  behaviorPercent: z.number().nullable(),
  performancePercent: z.number().nullable(),
  constraintsPercent: z.number().nullable(),
  sequencesPercent: z.number().nullable(),
  overallPercent: z.number(),
  reviewRequired: z.number(),
  redesignRequired: z.number(),
  blockingIssues: z.number(),
  notes: z.array(z.string()),
});

export const migrationReportDtoSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid(),
  generatedAt: z.string(),
  gateStatus: z.enum(REPORT_GATE_STATUSES),
  strategy: z.enum(MIGRATION_STRATEGIES),
  mappingRulesVersion: z.string(),
  promptVersion: z.string(),
  objectCount: z.number(),
  inScopeCount: z.number(),
  validatedCount: z.number(),
  deferredCount: z.number(),
  blockingCount: z.number(),
  readiness: readinessBreakdownDtoSchema,
  byStatus: z.record(z.number()),
  byReconcileAction: z.record(z.number()).optional().default({}),
  byType: z.record(
    z.object({
      total: z.number(),
      validated: z.number(),
    }),
  ),
  blocking: z.array(reportBlockingItemDtoSchema),
  reviewRequired: z.array(reportBlockingItemDtoSchema),
  redesignRequired: z.array(reportBlockingItemDtoSchema),
  tests: z.object({
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
  compile: z.object({
    firstAttempt: z.number(),
    afterRepair: z.number(),
    passed: z.number(),
    failed: z.number(),
  }),
  graph: z.object({
    nodeCount: z.number(),
    edgeCount: z.number(),
    layerCount: z.number(),
    cycleCount: z.number(),
    waitingCount: z.number(),
  }),
  ai: z.object({
    convertCount: z.number(),
    fixCount: z.number(),
    verifyCount: z.number(),
  }),
});

export type MigrationReportDto = z.infer<typeof migrationReportDtoSchema>;
export type ReportBlockingItemDto = z.infer<typeof reportBlockingItemDtoSchema>;

export const migrationReportSqlDtoSchema = z.object({
  filename: z.string(),
  objectCount: z.number(),
  sql: z.string(),
});

export type MigrationReportSqlDto = z.infer<typeof migrationReportSqlDtoSchema>;

export const conversionAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  objectId: z.string().uuid(),
  attemptNumber: z.number(),
  converterType: z.enum(CONVERTER_TYPES),
  mappingRulesVersion: z.string(),
  sourceHash: z.string().nullable(),
  generatedSql: z.string().nullable(),
  warnings: z.array(z.string()),
  riskFlags: z.array(z.string()),
  status: z.enum(CONVERSION_ATTEMPT_STATUSES),
  errorMessage: z.string().nullable(),
  durationMs: z.number(),
  createdAt: z.string(),
});

export type ConversionAttemptDto = z.infer<typeof conversionAttemptDtoSchema>;

export const validationAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  objectId: z.string().uuid(),
  attemptNumber: z.number(),
  generatedSql: z.string().nullable(),
  status: z.enum(VALIDATION_ATTEMPT_STATUSES),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  details: z.record(z.unknown()),
  durationMs: z.number(),
  createdAt: z.string(),
});

export type ValidationAttemptDto = z.infer<typeof validationAttemptDtoSchema>;

export const testAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  objectId: z.string().uuid(),
  attemptNumber: z.number(),
  status: z.enum(TEST_ATTEMPT_STATUSES),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  details: z.record(z.unknown()),
  durationMs: z.number(),
  createdAt: z.string(),
});

export type TestAttemptDto = z.infer<typeof testAttemptDtoSchema>;

export const conversionObjectDtoSchema = discoveredObjectSummaryDtoSchema.extend({
  sourceText: z.string().nullable(),
  attempts: z.array(conversionAttemptDtoSchema),
  validations: z.array(validationAttemptDtoSchema),
  tests: z.array(testAttemptDtoSchema),
});

export type ConversionObjectDto = z.infer<typeof conversionObjectDtoSchema>;

export const conversionRunObjectDtoSchema = discoveredObjectSummaryDtoSchema.omit({
  targetSql: true,
  reconcileSql: true,
});

export type ConversionRunObjectDto = z.infer<typeof conversionRunObjectDtoSchema>;

export const conversionRunDetailDtoSchema = z.object({
  run: migrationRunDtoSchema,
  objects: z.array(conversionRunObjectDtoSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

export const listConversionRunsQuerySchema = paginationQuerySchema;

export type ListConversionRunsQuery = z.infer<typeof listConversionRunsQuerySchema>;

export const listConversionRunObjectsQuerySchema = paginationQuerySchema.extend({
  objectType: z.enum(ORACLE_OBJECT_TYPES).optional(),
  status: z.enum(OBJECT_STATUSES).optional(),
  targetState: z.enum(TARGET_STATES).optional(),
  reconcileAction: z.enum(RECONCILE_ACTIONS).optional(),
});

export type ListConversionRunObjectsQuery = z.infer<typeof listConversionRunObjectsQuerySchema>;

export type ConversionRunDetailDto = z.infer<typeof conversionRunDetailDtoSchema>;

export const validatorSlotDtoSchema = z.object({
  id: z.string(),
  status: z.enum(VALIDATOR_SLOT_STATUSES),
  database: z.string(),
});

export type ValidatorSlotDto = z.infer<typeof validatorSlotDtoSchema>;

export const validatorPoolDtoSchema = z.object({
  mode: z.enum(VALIDATOR_MODES),
  size: z.number(),
  available: z.number(),
  busy: z.number(),
  healthy: z.boolean(),
  host: z.string().nullable(),
  port: z.number().nullable(),
  message: z.string(),
  slots: z.array(validatorSlotDtoSchema),
});

export type ValidatorPoolDto = z.infer<typeof validatorPoolDtoSchema>;

export const createAiProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(AI_PROVIDER_KINDS),
    baseUrl: z.string().trim().max(512).optional(),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().min(1).max(4096),
    enabled: z.boolean().default(true),
    roleConvert: z.boolean().default(true),
    roleFix: z.boolean().default(true),
    roleVerify: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "openai_compatible" && !value.baseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "baseUrl is required for OpenAI-compatible providers",
        path: ["baseUrl"],
      });
    }
    if (!value.roleConvert && !value.roleFix && !value.roleVerify) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enable at least one of convert, fix, or verify",
        path: ["roleConvert"],
      });
    }
  });

export type CreateAiProviderInput = z.infer<typeof createAiProviderSchema>;

export const updateAiProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(AI_PROVIDER_KINDS).optional(),
    baseUrl: z.string().trim().max(512).nullable().optional(),
    model: z.string().trim().min(1).max(200).optional(),
    apiKey: z.string().min(1).max(4096).optional(),
    enabled: z.boolean().optional(),
    roleConvert: z.boolean().optional(),
    roleFix: z.boolean().optional(),
    roleVerify: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "openai_compatible" && value.baseUrl === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "baseUrl is required for OpenAI-compatible providers",
        path: ["baseUrl"],
      });
    }
  });

export type UpdateAiProviderInput = z.infer<typeof updateAiProviderSchema>;

export const aiProviderDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(AI_PROVIDER_KINDS),
  baseUrl: z.string().nullable(),
  model: z.string(),
  hasApiKey: z.boolean(),
  enabled: z.boolean(),
  roleConvert: z.boolean(),
  roleFix: z.boolean(),
  roleVerify: z.boolean(),
  lastTestedAt: z.string().nullable(),
  lastTestStatus: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AiProviderDto = z.infer<typeof aiProviderDtoSchema>;

export const aiProviderTestResultSchema = z.object({
  ok: z.boolean(),
  models: z.array(z.string()),
  message: z.string(),
});

export type AiProviderTestResult = z.infer<typeof aiProviderTestResultSchema>;

export type ConversionJobData = {
  projectId: string;
  runId: string;
};

export type ValidationJobData = {
  projectId: string;
  runId: string;
};

export type ReportingJobData = {
  projectId: string;
  runId: string;
};

export const startDataCopySchema = z
  .object({
    chunkSize: z.coerce.number().int().min(1).max(DATA_COPY_CHUNK_SIZE_MAX).optional(),
  })
  .strict();

export type StartDataCopyInput = z.infer<typeof startDataCopySchema>;

export const dataCopyTableDtoSchema = z.object({
  id: z.string().uuid(),
  copyRunId: z.string().uuid(),
  objectId: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  targetSchema: z.string(),
  targetName: z.string(),
  status: z.enum(DATA_COPY_TABLE_STATUSES),
  oracleRows: z.number().nullable(),
  postgresRows: z.number().nullable(),
  copiedRows: z.number(),
  lastOffset: z.number(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DataCopyTableDto = z.infer<typeof dataCopyTableDtoSchema>;

export const dataCopyRunDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conversionRunId: z.string().uuid(),
  status: z.enum(DATA_COPY_RUN_STATUSES),
  dataMode: z.enum(DATA_MODES),
  chunkSize: z.number(),
  tableCount: z.number(),
  copiedCount: z.number(),
  failedCount: z.number(),
  matchedCount: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tables: z.array(dataCopyTableDtoSchema),
});

export type DataCopyRunDto = z.infer<typeof dataCopyRunDtoSchema>;

export type DataCopyJobData = {
  projectId: string;
  conversionRunId: string;
  copyRunId: string;
};

export const startDeploySchema = z.object({}).strict();

export type StartDeployInput = z.infer<typeof startDeploySchema>;

export const deployObjectDtoSchema = z.object({
  id: z.string().uuid(),
  deployRunId: z.string().uuid(),
  objectId: z.string().uuid(),
  owner: z.string(),
  name: z.string(),
  objectType: z.string(),
  targetSchema: z.string().nullable(),
  targetName: z.string().nullable(),
  sortIndex: z.number(),
  status: z.enum(DEPLOY_OBJECT_STATUSES),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DeployObjectDto = z.infer<typeof deployObjectDtoSchema>;

export const deployRunDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  conversionRunId: z.string().uuid(),
  status: z.enum(DEPLOY_RUN_STATUSES),
  gateStatus: z.enum(REPORT_GATE_STATUSES),
  objectCount: z.number(),
  deployedCount: z.number(),
  failedCount: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  objects: z.array(deployObjectDtoSchema),
});

export type DeployRunDto = z.infer<typeof deployRunDtoSchema>;

export type DeployJobData = {
  projectId: string;
  conversionRunId: string;
  deployRunId: string;
};
