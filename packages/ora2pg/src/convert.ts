import {
  type ConversionAttemptStatus,
  type ConverterType,
  type DiscoveredColumn,
  HIGH_RISK_MARKERS,
  isPhase4ObjectType,
  MAPPING_RULES_VERSION,
  type OracleObjectType,
  type RiskLevel,
} from "@migrator/shared";
import { mapOracleDataType, ORACLE_TYPE_PATTERN } from "./types";

export interface ConversionResult {
  sql: string | null;
  warnings: string[];
  riskFlags: string[];
  riskLevel: RiskLevel;
  status: ConversionAttemptStatus;
  converterType: ConverterType;
  targetSchema: string;
  targetName: string;
  mappingRulesVersion: string;
  errorMessage: string | null;
}

const STORAGE_NOISE = /\s+(?:PCTFREE|PCTUSED|INITRANS|MAXTRANS|FREELISTS|FREELIST GROUPS)\s+\d+/gi;
const TABLESPACE_NOISE = /\s+TABLESPACE\s+(?:"[^"]+"|[A-Z0-9_]+)/gi;
const STORAGE_CLAUSE = /\s+STORAGE\s*\((?:[^()]*|\([^()]*\))*\)/gi;
const MISC_NOISE =
  /\s+(?:LOGGING|NOLOGGING|NOCOMPRESS|COMPRESS(?:\s+FOR\s+\w+)?(?:\s+\d+)?|MONITORING|NOMONITORING|ROWDEPENDENCIES|NOROWDEPENDENCIES|COMPUTE\s+STATISTICS|PARALLEL(?:\s+\d+)?|NOPARALLEL|SEGMENT\s+CREATION\s+(?:IMMEDIATE|DEFERRED)|NOKEEP|NOSCALE|NOORDER|KEEP)/gi;
const ENABLE_NOISE = /\s+(?:ENABLE|DISABLE|VALIDATE|NOVALIDATE)\b/gi;
const SUPPLEMENTAL_LOG_DATA = /,?\s*SUPPLEMENTAL\s+LOG\s+DATA\s*\([^)]*\)\s*COLUMNS/gi;
const SUPPLEMENTAL_LOG_GROUP =
  /,?\s*SUPPLEMENTAL\s+LOG\s+GROUP\s+(?:"[^"]+"|[A-Z0-9_]+)\s*\([^)]*\)(?:\s+ALWAYS)?/gi;
const LOB_STORE_AS =
  /\s*LOB\s*\([^)]*\)\s+STORE\s+AS(?:\s+\w+)?(?:\s*\((?:[^()]*|\([^()]*\))*\))?/gi;
const RESULT_CACHE = /\s+RESULT_CACHE\s*\([^)]*\)/gi;
const USING_INDEX_UNTIL_ENABLE = /\s+USING\s+INDEX[\s\S]*?\s+(?:ENABLE|DISABLE)\b/gi;
const USING_INDEX_NAME =
  /\s+USING\s+INDEX(?:\s*\([\s\S]*?\))?(?:\s+(?:"[^"]+"|[A-Z0-9_]+)(?:\s*\.\s*(?:"[^"]+"|[A-Z0-9_]+))?)?/gi;
const QUOTED_IDENT = /"((?:[^"]|"")*)"/g;
const EXTRA_INDEX_DDL = /\s+CREATE\s+(?:UNIQUE\s+)?INDEX\b/i;
const CREATE_INDEX_NAME =
  /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:("[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/gi;

export function toPgIdent(raw: string): string {
  const unquoted = raw.replace(/^"/, "").replace(/"$/, "").replace(/""/g, '"');
  if (/^[A-Z][A-Z0-9_]*$/.test(unquoted)) {
    return unquoted.toLowerCase();
  }
  return `"${unquoted.replace(/"/g, '""')}"`;
}

export function rewriteIdentifiers(sql: string): string {
  return sql.replace(QUOTED_IDENT, (_match, value: string) => toPgIdent(`"${value}"`));
}

export function mapTypesInSql(sql: string): string {
  const pattern = new RegExp(ORACLE_TYPE_PATTERN.source, ORACLE_TYPE_PATTERN.flags);
  return sql.replace(pattern, (match) => mapOracleDataType(match) ?? match);
}

export function detectRiskFlags(sql: string): string[] {
  const upper = sql.toUpperCase();
  return HIGH_RISK_MARKERS.filter((marker) => upper.includes(marker));
}

export function riskLevelFor(flags: string[]): RiskLevel {
  if (flags.length === 0) {
    return "LOW";
  }
  if (flags.some((flag) => flag.startsWith("DBMS_") || flag === "EXECUTE IMMEDIATE")) {
    return "HIGH";
  }
  return flags.length >= 2 ? "HIGH" : "MEDIUM";
}

function stripUsingIndex(sql: string): string {
  return sql.replace(USING_INDEX_UNTIL_ENABLE, " ").replace(USING_INDEX_NAME, " ");
}

function applyOracleNoise(sql: string): string {
  return stripUsingIndex(sql)
    .replace(STORAGE_CLAUSE, "")
    .replace(LOB_STORE_AS, "")
    .replace(SUPPLEMENTAL_LOG_DATA, "")
    .replace(SUPPLEMENTAL_LOG_GROUP, "")
    .replace(RESULT_CACHE, "")
    .replace(TABLESPACE_NOISE, "")
    .replace(STORAGE_NOISE, "")
    .replace(MISC_NOISE, "")
    .replace(ENABLE_NOISE, "")
    .replace(/\bSYSTIMESTAMP\b/gi, "CURRENT_TIMESTAMP")
    .replace(/\bSYSDATE\b/gi, "CURRENT_TIMESTAMP")
    .replace(/\bNVL\s*\(/gi, "COALESCE(")
    .replace(/\s+/g, " ")
    .trim();
}

function qualifiedName(
  owner: string,
  name: string,
): { schema: string; ident: string; qualified: string } {
  const schema = toPgIdent(owner);
  const ident = toPgIdent(name);
  return { schema, ident, qualified: `${schema}.${ident}` };
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  return `${trimmed};`;
}

function unqualifyIndexName(sql: string): string {
  return sql.replace(
    CREATE_INDEX_NAME,
    (_match, unique: string | undefined, _schema: string | undefined, ident: string) =>
      `CREATE ${unique ?? ""}INDEX ${ident}`,
  );
}

function isColumnAddAlter(sql: string): boolean {
  if (!/^\s*ALTER\s+TABLE\b/i.test(sql)) {
    return false;
  }
  if (/\bADD\s+CONSTRAINT\b/i.test(sql)) {
    return false;
  }
  if (/\bADD\s+(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(sql)) {
    return false;
  }
  return /\bADD\s*\(/i.test(sql) || /\bADD\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+/i.test(sql);
}

function takeLeadingCreateTable(sql: string): string {
  if (!/^\s*CREATE\s+(?:GLOBAL\s+)?(?:TEMPORARY\s+)?TABLE\b/i.test(sql)) {
    return sql;
  }
  const indexAt = sql.search(EXTRA_INDEX_DDL);
  const withoutIndex = indexAt > 0 ? sql.slice(0, indexAt) : sql;
  const alterAt = withoutIndex.search(/\s+ALTER\s+TABLE\b/i);
  if (alterAt < 0) {
    return withoutIndex.trim();
  }
  const createPart = withoutIndex.slice(0, alterAt).trim();
  const alters = withoutIndex
    .slice(alterAt)
    .split(/(?=\s*ALTER\s+TABLE\b)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && isColumnAddAlter(part));
  return [createPart, ...alters].join("\n");
}

function sqlHasColumn(sql: string, columnName: string): boolean {
  const ident = toPgIdent(columnName).replace(/^"|"$/g, "");
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`(?:^|[\\s,(])"${escaped}"(?:$|[\\s,)])`, "i").test(sql) ||
    new RegExp(`(?:^|[\\s,(])${escaped}(?:$|[\\s,)])`, "i").test(sql)
  );
}

function oracleCatalogType(column: {
  dataType: string;
  dataLength: number | null;
  dataPrecision: number | null;
  dataScale: number | null;
}): string {
  const type = column.dataType.trim().toUpperCase();
  if (type === "NUMBER" || type === "NUMERIC" || type === "DECIMAL") {
    if (column.dataPrecision != null && column.dataScale != null) {
      return mapOracleDataType(`NUMBER(${column.dataPrecision},${column.dataScale})`) ?? "numeric";
    }
    if (column.dataPrecision != null) {
      return mapOracleDataType(`NUMBER(${column.dataPrecision})`) ?? "bigint";
    }
    return mapOracleDataType("NUMBER") ?? "bigint";
  }
  if (
    type === "VARCHAR2" ||
    type === "VARCHAR" ||
    type === "NVARCHAR2" ||
    type === "CHAR" ||
    type === "NCHAR" ||
    type === "RAW"
  ) {
    const length = column.dataLength ?? 4000;
    return mapOracleDataType(`${type}(${length})`) ?? "text";
  }
  return mapOracleDataType(type) ?? "text";
}

function appendMissingCatalogColumns(
  sql: string,
  owner: string,
  name: string,
  columns: Array<{
    name: string;
    dataType: string;
    nullable: boolean;
    dataLength: number | null;
    dataPrecision: number | null;
    dataScale: number | null;
  }>,
): { sql: string; added: string[] } {
  if (columns.length === 0 || !/create\s+(?:temporary\s+)?table\b/i.test(sql)) {
    return { sql, added: [] };
  }
  const names = qualifiedName(owner, name);
  const added: string[] = [];
  const statements: string[] = [];
  for (const column of columns) {
    if (sqlHasColumn(sql, column.name)) {
      continue;
    }
    added.push(toPgIdent(column.name));
    const nullSql = column.nullable ? "" : " NOT NULL";
    statements.push(
      `ALTER TABLE ${names.qualified} ADD COLUMN ${toPgIdent(column.name)} ${oracleCatalogType(column)}${nullSql};`,
    );
  }
  if (statements.length === 0) {
    return { sql, added };
  }
  return { sql: `${sql.replace(/;+\s*$/, "")};\n${statements.join("\n")}`, added };
}

function rewriteGlobalTemporaryTable(
  sql: string,
  tableIdent: string,
): { sql: string; gtt: boolean } {
  if (!/CREATE\s+GLOBAL\s+TEMPORARY\s+TABLE/i.test(sql)) {
    return { sql, gtt: false };
  }
  return {
    sql: sql.replace(
      /CREATE\s+GLOBAL\s+TEMPORARY\s+TABLE\s+(?:"[^"]+"|[A-Z0-9_]+)(?:\s*\.\s*(?:"[^"]+"|[A-Z0-9_]+))?/i,
      `CREATE TEMPORARY TABLE ${tableIdent}`,
    ),
    gtt: true,
  };
}

function finish(
  result: Omit<ConversionResult, "mappingRulesVersion" | "converterType">,
): ConversionResult {
  const riskFlags = [...new Set(result.riskFlags)];
  const riskLevel = result.riskLevel === "LOW" ? riskLevelFor(riskFlags) : result.riskLevel;
  const status: ConversionAttemptStatus =
    result.status === "FAILED"
      ? "FAILED"
      : riskLevel === "HIGH" || riskFlags.length > 0
        ? "REVIEW_REQUIRED"
        : result.status;
  return {
    ...result,
    riskFlags,
    riskLevel,
    status,
    converterType: "RULES",
    mappingRulesVersion: MAPPING_RULES_VERSION,
  };
}

function convertSequence(source: string, owner: string, name: string): ConversionResult {
  const names = qualifiedName(owner, name);
  let sql = applyOracleNoise(source);
  sql = rewriteIdentifiers(sql);
  sql = sql.replace(/\bNOCYCLE\b/gi, "NO CYCLE");
  sql = sql.replace(/\bNOCACHE\b/gi, "CACHE 1");
  sql = sql.replace(/\bMAXVALUE\s+9{10,}/gi, "");
  sql = sql.replace(/\s+\b(?:GLOBAL|SESSION)\b/gi, "");
  sql = sql.replace(/\s+/g, " ").trim();
  sql = ensureSemicolon(sql);
  if (!/create\s+sequence/i.test(sql)) {
    sql = `CREATE SEQUENCE ${names.qualified};`;
  }
  return finish({
    sql: `CREATE SCHEMA IF NOT EXISTS ${names.schema};\n${sql}`,
    warnings: [],
    riskFlags: detectRiskFlags(source),
    riskLevel: "LOW",
    status: "SUCCEEDED",
    targetSchema: names.schema,
    targetName: names.ident,
    errorMessage: null,
  });
}

function convertIndex(source: string, owner: string, name: string): ConversionResult {
  const names = qualifiedName(owner, name);
  const warnings: string[] = [];
  const riskFlags = detectRiskFlags(source);
  if (/\bBITMAP\b/i.test(source)) {
    warnings.push("Oracle BITMAP index converted as a btree index");
    riskFlags.push("BITMAP");
  }
  let sql = applyOracleNoise(source.replace(/\bBITMAP\b/i, ""));
  sql = rewriteIdentifiers(sql);
  sql = mapTypesInSql(sql);
  sql = unqualifyIndexName(sql);
  sql = ensureSemicolon(sql);
  return finish({
    sql: `CREATE SCHEMA IF NOT EXISTS ${names.schema};\n${sql}`,
    warnings,
    riskFlags,
    riskLevel: "LOW",
    status: "SUCCEEDED",
    targetSchema: names.schema,
    targetName: names.ident,
    errorMessage: null,
  });
}

function convertTableOrConstraint(
  source: string,
  owner: string,
  name: string,
  columns: DiscoveredColumn[] = [],
): ConversionResult {
  const names = qualifiedName(owner, name);
  const riskFlags = detectRiskFlags(source);
  const warnings: string[] = [];
  if (/\bVIRTUAL\b/i.test(source)) {
    warnings.push("Virtual columns may need a generated-column rewrite");
    riskFlags.push("VIRTUAL");
  }
  const gtt = rewriteGlobalTemporaryTable(source, names.ident);
  if (gtt.gtt) {
    warnings.push(
      "Oracle GLOBAL TEMPORARY TABLE is session-scoped in PostgreSQL and is not schema-qualified",
    );
  }
  let sql = applyOracleNoise(gtt.sql);
  sql = sql.replace(/\s+NOCACHE\b/gi, "").replace(/\s+\bCACHE\b/gi, "");
  sql = rewriteIdentifiers(sql);
  sql = mapTypesInSql(sql);
  sql = takeLeadingCreateTable(sql);
  sql = ensureSemicolon(sql);
  const patched = appendMissingCatalogColumns(sql, owner, name, columns);
  if (patched.added.length > 0) {
    warnings.push(
      `Oracle catalog has columns missing from extracted DDL; added ${patched.added.join(", ")}`,
    );
  }
  return finish({
    sql: `CREATE SCHEMA IF NOT EXISTS ${names.schema};\n${patched.sql}`,
    warnings,
    riskFlags,
    riskLevel: "LOW",
    status: "SUCCEEDED",
    targetSchema: names.schema,
    targetName: names.ident,
    errorMessage: null,
  });
}

function convertView(source: string, owner: string, name: string): ConversionResult {
  const names = qualifiedName(owner, name);
  const riskFlags = detectRiskFlags(source);
  const warnings: string[] = [];
  if (/\bDECODE\s*\(/i.test(source)) {
    warnings.push("DECODE was not rewritten; review the view");
    riskFlags.push("DECODE");
  }
  if (/\bROWNUM\b/i.test(source)) {
    warnings.push("ROWNUM has no direct PostgreSQL equivalent");
    riskFlags.push("ROWNUM");
  }
  let sql = applyOracleNoise(source);
  sql = sql.replace(
    /\bCREATE\s+OR\s+REPLACE\s+(?:FORCE\s+)?(?:EDITIONABLE\s+)?VIEW\b/gi,
    "CREATE OR REPLACE VIEW",
  );
  sql = sql.replace(/\bCREATE\s+(?:FORCE\s+)?(?:EDITIONABLE\s+)?VIEW\b/gi, "CREATE VIEW");
  sql = rewriteIdentifiers(sql);
  sql = mapTypesInSql(sql);
  sql = ensureSemicolon(sql);
  return finish({
    sql: `CREATE SCHEMA IF NOT EXISTS ${names.schema};\n${sql}`,
    warnings,
    riskFlags,
    riskLevel: "LOW",
    status: "SUCCEEDED",
    targetSchema: names.schema,
    targetName: names.ident,
    errorMessage: null,
  });
}

export function convertOracleDdl(input: {
  objectType: OracleObjectType;
  owner: string;
  name: string;
  sourceText: string | null;
  columns?: DiscoveredColumn[];
}): ConversionResult {
  const names = qualifiedName(input.owner, input.name);
  if (!isPhase4ObjectType(input.objectType)) {
    return finish({
      sql: null,
      warnings: [],
      riskFlags: [],
      riskLevel: "LOW",
      status: "REVIEW_REQUIRED",
      targetSchema: names.schema,
      targetName: names.ident,
      errorMessage: `${input.objectType} is not converted in the deterministic Phase 4/5 engine`,
    });
  }
  if (!input.sourceText || input.sourceText.trim().length === 0) {
    return finish({
      sql: null,
      warnings: [],
      riskFlags: [],
      riskLevel: "LOW",
      status: "FAILED",
      targetSchema: names.schema,
      targetName: names.ident,
      errorMessage: "No extracted Oracle DDL to convert",
    });
  }
  try {
    switch (input.objectType) {
      case "SEQUENCE":
        return convertSequence(input.sourceText, input.owner, input.name);
      case "INDEX":
        return convertIndex(input.sourceText, input.owner, input.name);
      case "VIEW":
        return convertView(input.sourceText, input.owner, input.name);
      case "TABLE":
      case "CONSTRAINT":
        return convertTableOrConstraint(
          input.sourceText,
          input.owner,
          input.name,
          input.columns ?? [],
        );
    }
  } catch (error) {
    return finish({
      sql: null,
      warnings: [],
      riskFlags: detectRiskFlags(input.sourceText),
      riskLevel: "HIGH",
      status: "FAILED",
      targetSchema: names.schema,
      targetName: names.ident,
      errorMessage: error instanceof Error ? error.message : "Conversion failed",
    });
  }
}
