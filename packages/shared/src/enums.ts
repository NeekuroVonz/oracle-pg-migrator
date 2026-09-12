export const OBJECT_STATUSES = [
  "DISCOVERED",
  "EXCLUDED",
  "WAITING_DEPENDENCY",
  "QUEUED",
  "EXTRACTING",
  "EXTRACTED",
  "CLASSIFYING",
  "CONVERTING_RULE",
  "CONVERTING_AI",
  "COMPILING",
  "TESTING",
  "VERIFYING",
  "RETRYING",
  "VALIDATED",
  "REVIEW_REQUIRED",
  "REDESIGN_REQUIRED",
  "FAILED",
] as const;

export type ObjectStatus = (typeof OBJECT_STATUSES)[number];

export const MIGRATION_STRATEGIES = ["FAST", "BALANCED", "MAXIMUM_ACCURACY"] as const;
export type MigrationStrategy = (typeof MIGRATION_STRATEGIES)[number];

export const MIGRATION_STRATEGY_LABELS: Record<MigrationStrategy, string> = {
  FAST: "FAST",
  BALANCED: "BALANCED",
  MAXIMUM_ACCURACY: "MAXIMUM ACCURACY",
};

export const CONNECTION_ROLES = ["SOURCE", "TARGET"] as const;
export type ConnectionRole = (typeof CONNECTION_ROLES)[number];

export const DB_ENGINES = ["ORACLE", "POSTGRESQL"] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

export const ACCESS_MODES = ["READ_ONLY", "READ_WRITE"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const ORACLE_CONNECT_TYPES = ["SID", "SERVICE_NAME", "TNS"] as const;
export type OracleConnectType = (typeof ORACLE_CONNECT_TYPES)[number];

export const PG_SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"] as const;
export type PgSslMode = (typeof PG_SSL_MODES)[number];

export const SOURCE_ORACLE_ACCESS = {
  engine: "ORACLE",
  accessMode: "READ_ONLY",
  allowWrite: false,
} as const;

export const DISCOVERY_RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

export const ORACLE_OBJECT_TYPES = [
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
] as const;
export type OracleObjectType = (typeof ORACLE_OBJECT_TYPES)[number];

export const WRITE_PRIVILEGE_WARNING =
  "The configured Oracle account appears to have write privileges. This application will still enforce read-only behavior, but using a dedicated read-only Oracle account is strongly recommended.";

export const DATA_MODES = ["NONE", "SELECTED_TABLES", "ALL_SELECTED_TABLES"] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const DATA_COPY_CHUNK_SIZE_DEFAULT = 1000;
export const DATA_COPY_CHUNK_SIZE_MAX = 5000;

export const DATA_COPY_RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type DataCopyRunStatus = (typeof DATA_COPY_RUN_STATUSES)[number];

export const DATA_COPY_TABLE_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type DataCopyTableStatus = (typeof DATA_COPY_TABLE_STATUSES)[number];

export const DEPLOY_RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type DeployRunStatus = (typeof DEPLOY_RUN_STATUSES)[number];

export const DEPLOY_OBJECT_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type DeployObjectStatus = (typeof DEPLOY_OBJECT_STATUSES)[number];

export const SCOPE_EXCLUSION_REASONS = [
  "schema",
  "object_type",
  "include_pattern",
  "exclude_pattern",
  "exact_exclusion",
] as const;
export type ScopeExclusionReason = (typeof SCOPE_EXCLUSION_REASONS)[number];

export const DAG_BLOCKED_REASONS = ["OUT_OF_SCOPE", "DEFERRED"] as const;
export type DagBlockedReason = (typeof DAG_BLOCKED_REASONS)[number];

export const PHASE_4_OBJECT_TYPES = ["TABLE", "SEQUENCE", "CONSTRAINT", "INDEX", "VIEW"] as const;
export type Phase4ObjectType = (typeof PHASE_4_OBJECT_TYPES)[number];

export function isPhase4ObjectType(type: OracleObjectType): type is Phase4ObjectType {
  return (PHASE_4_OBJECT_TYPES as readonly string[]).includes(type);
}

export const DETERMINISTIC_SCHEMA_TYPES = ["TABLE", "SEQUENCE", "CONSTRAINT", "INDEX"] as const;

export function isDeterministicSchemaType(type: string): boolean {
  return (DETERMINISTIC_SCHEMA_TYPES as readonly string[]).includes(type.toUpperCase());
}

export const MIGRATION_RUN_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number];

export const CONVERSION_ATTEMPT_STATUSES = ["SUCCEEDED", "FAILED", "REVIEW_REQUIRED"] as const;
export type ConversionAttemptStatus = (typeof CONVERSION_ATTEMPT_STATUSES)[number];

export const CONVERTER_TYPES = ["RULES", "ORA2PG", "AI"] as const;
export type ConverterType = (typeof CONVERTER_TYPES)[number];

export const AI_PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "gemini",
  "cursor",
  "openai_compatible",
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_PROVIDER_ROLES = ["convert", "fix", "verify"] as const;
export type AiProviderRole = (typeof AI_PROVIDER_ROLES)[number];

export const AI_PROMPT_VERSION = "v1";

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const VALIDATION_ATTEMPT_STATUSES = ["PASSED", "FAILED"] as const;
export type ValidationAttemptStatus = (typeof VALIDATION_ATTEMPT_STATUSES)[number];

export const COMPILE_STATUSES = ["PASSED", "FAILED", "SKIPPED"] as const;
export type CompileStatus = (typeof COMPILE_STATUSES)[number];

export const TARGET_STATES = [
  "TARGET_MISSING",
  "TARGET_MATCHED",
  "TARGET_DIFFERENT",
  "TARGET_DRIFTED",
  "TARGET_CONFLICT",
] as const;
export type TargetState = (typeof TARGET_STATES)[number];

export const RECONCILE_ACTIONS = [
  "CREATE_REQUIRED",
  "SKIP_UNCHANGED",
  "UPDATE_REQUIRED",
  "REPLACE_REQUIRED",
  "REVIEW_REQUIRED",
] as const;
export type ReconcileAction = (typeof RECONCILE_ACTIONS)[number];

export const TARGET_STATE_LABELS: Record<TargetState, string> = {
  TARGET_MISSING: "needs create",
  TARGET_MATCHED: "already exists and correct",
  TARGET_DIFFERENT: "needs update",
  TARGET_DRIFTED: "drift detected",
  TARGET_CONFLICT: "conflict",
};

export const RECONCILE_ACTION_LABELS: Record<ReconcileAction, string> = {
  CREATE_REQUIRED: "needs create",
  SKIP_UNCHANGED: "skipped",
  UPDATE_REQUIRED: "needs update",
  REPLACE_REQUIRED: "needs update",
  REVIEW_REQUIRED: "review required",
};

export const TEST_ATTEMPT_STATUSES = ["PASSED", "FAILED", "SKIPPED"] as const;
export type TestAttemptStatus = (typeof TEST_ATTEMPT_STATUSES)[number];

export const VALIDATOR_MODES = ["database", "docker"] as const;
export type ValidatorMode = (typeof VALIDATOR_MODES)[number];

export const VALIDATOR_SLOT_STATUSES = ["idle", "busy", "unhealthy"] as const;
export type ValidatorSlotStatus = (typeof VALIDATOR_SLOT_STATUSES)[number];

export const MAPPING_RULES_VERSION = "ora2pg-compat-v2";

export const REPORT_GATE_STATUSES = ["IN_PROGRESS", "BLOCKED", "READY_FOR_DEPLOYMENT"] as const;
export type ReportGateStatus = (typeof REPORT_GATE_STATUSES)[number];

export const REPORT_BLOCKING_STATUSES = [
  "FAILED",
  "REVIEW_REQUIRED",
  "REDESIGN_REQUIRED",
  "WAITING_DEPENDENCY",
] as const;

export const HIGH_RISK_MARKERS = [
  "CONNECT BY",
  "ROWID",
  "DBMS_",
  "UTL_FILE",
  "EXECUTE IMMEDIATE",
  "PRAGMA AUTONOMOUS_TRANSACTION",
  "BULK COLLECT",
  "FORALL",
  "PIPELINED",
  "REF CURSOR",
  "SYS_REFCURSOR",
] as const;
