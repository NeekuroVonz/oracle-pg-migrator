import type { OracleObjectType } from "@migrator/shared";

export const SYSTEM_ORACLE_SCHEMAS = new Set([
  "ANONYMOUS",
  "APPQOSSYS",
  "AUDSYS",
  "CTXSYS",
  "DBSFWUSER",
  "DBSNMP",
  "DIP",
  "DVF",
  "DVSYS",
  "GGSYS",
  "GSMADMIN_INTERNAL",
  "GSMCATUSER",
  "GSMUSER",
  "GSMROOTUSER",
  "LBACSYS",
  "MDDATA",
  "MDSYS",
  "OJVMSYS",
  "OLAPSYS",
  "ORACLE_OCM",
  "ORDDATA",
  "ORDPLUGINS",
  "ORDSYS",
  "OUTLN",
  "REMOTE_SCHEDULER_AGENT",
  "SI_INFORMTN_SCHEMA",
  "SYS",
  "SYS$UMF",
  "SYSBACKUP",
  "SYSDG",
  "SYSKM",
  "SYSRAC",
  "SYSTEM",
  "WMSYS",
  "XDB",
  "XS$NULL",
]);

const DICTIONARY_TYPE_MAP: Record<string, OracleObjectType> = {
  TABLE: "TABLE",
  VIEW: "VIEW",
  "MATERIALIZED VIEW": "MATERIALIZED_VIEW",
  SEQUENCE: "SEQUENCE",
  INDEX: "INDEX",
  FUNCTION: "FUNCTION",
  PROCEDURE: "PROCEDURE",
  TRIGGER: "TRIGGER",
  PACKAGE: "PACKAGE",
  "PACKAGE BODY": "PACKAGE_BODY",
  TYPE: "TYPE",
  "TYPE BODY": "TYPE_BODY",
  SYNONYM: "SYNONYM",
  "DATABASE LINK": "DATABASE_LINK",
  JOB: "SCHEDULER_JOB",
  CONSTRAINT: "CONSTRAINT",
  SCHEDULER_JOB: "SCHEDULER_JOB",
};

export function mapOracleDictionaryType(oracleType: string): OracleObjectType | null {
  return DICTIONARY_TYPE_MAP[oracleType.trim().toUpperCase()] ?? null;
}

export function ddlDictionaryType(objectType: OracleObjectType): string | null {
  switch (objectType) {
    case "TABLE":
      return "TABLE";
    case "VIEW":
      return "VIEW";
    case "MATERIALIZED_VIEW":
      return "MATERIALIZED VIEW";
    case "SEQUENCE":
      return "SEQUENCE";
    case "SYNONYM":
      return "SYNONYM";
    case "DATABASE_LINK":
      return "DATABASE LINK";
    case "INDEX":
    case "CONSTRAINT":
    case "FUNCTION":
    case "PROCEDURE":
    case "TRIGGER":
    case "PACKAGE":
    case "PACKAGE_BODY":
    case "TYPE":
    case "TYPE_BODY":
    case "SCHEDULER_JOB":
      return null;
    default: {
      const exhaustive: never = objectType;
      throw new Error(`unsupported object type: ${String(exhaustive)}`);
    }
  }
}

export function ddlObjectType(objectType: OracleObjectType): string | null {
  switch (objectType) {
    case "TABLE":
      return "TABLE";
    case "VIEW":
      return "VIEW";
    case "MATERIALIZED_VIEW":
      return "MATERIALIZED_VIEW";
    case "SEQUENCE":
      return "SEQUENCE";
    case "INDEX":
      return "INDEX";
    case "CONSTRAINT":
      return "CONSTRAINT";
    case "FUNCTION":
      return "FUNCTION";
    case "PROCEDURE":
      return "PROCEDURE";
    case "TRIGGER":
      return "TRIGGER";
    case "PACKAGE":
      return "PACKAGE";
    case "PACKAGE_BODY":
      return "PACKAGE_BODY";
    case "TYPE":
      return "TYPE";
    case "TYPE_BODY":
      return "TYPE_BODY";
    case "SYNONYM":
      return "SYNONYM";
    case "DATABASE_LINK":
      return "DB_LINK";
    case "SCHEDULER_JOB":
      return null;
    default: {
      const exhaustive: never = objectType;
      throw new Error(`unsupported object type: ${String(exhaustive)}`);
    }
  }
}

export function sourceDictionaryType(objectType: OracleObjectType): string | null {
  switch (objectType) {
    case "FUNCTION":
      return "FUNCTION";
    case "PROCEDURE":
      return "PROCEDURE";
    case "TRIGGER":
      return "TRIGGER";
    case "PACKAGE":
      return "PACKAGE";
    case "PACKAGE_BODY":
      return "PACKAGE BODY";
    case "TYPE":
      return "TYPE";
    case "TYPE_BODY":
      return "TYPE BODY";
    case "TABLE":
    case "VIEW":
    case "MATERIALIZED_VIEW":
    case "SEQUENCE":
    case "INDEX":
    case "CONSTRAINT":
    case "SYNONYM":
    case "DATABASE_LINK":
    case "SCHEDULER_JOB":
      return null;
    default: {
      const exhaustive: never = objectType;
      throw new Error(`unsupported object type: ${String(exhaustive)}`);
    }
  }
}
