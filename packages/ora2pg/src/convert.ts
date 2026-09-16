import {
  type ConversionAttemptStatus,
  type ConverterType,
  type DiscoveredColumn,
  HIGH_RISK_MARKERS,
  isDeterministicSchemaType,
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

function plainTableIdent(raw: string): string {
  const unquoted = raw.replace(/^"/, "").replace(/"$/, "").replace(/""/g, '"');
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(unquoted)) {
    return unquoted.toLowerCase();
  }
  return toPgIdent(raw);
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
  if (
    flags.some(
      (flag) =>
        flag.startsWith("DBMS_") ||
        flag === "EXECUTE IMMEDIATE" ||
        flag === "CONNECT BY" ||
        flag === "START WITH" ||
        flag === "MODEL" ||
        flag === "XMLTYPE",
    )
  ) {
    return "HIGH";
  }
  return flags.length >= 2 ? "HIGH" : "MEDIUM";
}

function stripUsingIndex(sql: string): string {
  return sql.replace(USING_INDEX_UNTIL_ENABLE, " ").replace(USING_INDEX_NAME, " ");
}

function stripSqlComments(sql: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      out += "\n";
      continue;
    }
    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function matchingParenEnd(sql: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = openIndex; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) {
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function stripOraclePartitionClause(sql: string): { sql: string; stripped: boolean } {
  const start = sql.search(/\s+PARTITION\s+BY\b/i);
  if (start < 0) {
    return { sql, stripped: false };
  }
  const rest = sql.slice(start);
  const header = /^\s*PARTITION\s+BY\s+[A-Za-z_][\w$]*\s*\(/i.exec(rest);
  if (!header) {
    return { sql: sql.slice(0, start).trimEnd(), stripped: true };
  }
  const rangeOpen = start + header[0].lastIndexOf("(");
  const rangeClose = matchingParenEnd(sql, rangeOpen);
  if (rangeClose < 0) {
    return { sql: sql.slice(0, start).trimEnd(), stripped: true };
  }
  let i = rangeClose + 1;
  while (i < sql.length && /\s/.test(sql[i] ?? "")) {
    i += 1;
  }
  if (sql[i] === "(") {
    const listClose = matchingParenEnd(sql, i);
    i = listClose < 0 ? sql.length : listClose + 1;
  }
  return { sql: `${sql.slice(0, start)}${sql.slice(i)}`.replace(/\s+;/g, ";"), stripped: true };
}

export function rewriteSequenceNextval(sql: string): string {
  return sql.replace(
    /\b((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s*\.\s*(nextval|currval)\b/gi,
    (_match, ident: string, kind: string) => {
      const cleaned = ident.replace(/\s+/g, "").replace(/"/g, "").toLowerCase();
      return `${kind.toLowerCase()}('${cleaned}')`;
    },
  );
}

/** Oracle DECODE(expr, search, result [, search, result ...] [, default]) → CASE */
export function rewriteDecode(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const slice = sql.slice(i);
    const start = /^DECODE\s*\(/i.exec(slice);
    if (!start) {
      out += sql[i];
      i += 1;
      continue;
    }
    const open = i + start[0].length - 1;
    const close = matchingParenEnd(sql, open);
    if (close < 0) {
      out += sql[i];
      i += 1;
      continue;
    }
    const inner = sql.slice(open + 1, close);
    const args = splitTopLevelArgs(inner);
    if (args.length < 3) {
      out += sql.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const expr = args[0] ?? "";
    const pairs: string[] = [];
    let defaultSql = "NULL";
    let cursor = 1;
    while (cursor < args.length) {
      if (cursor + 1 >= args.length) {
        defaultSql = args[cursor] ?? "NULL";
        break;
      }
      pairs.push(`WHEN ${args[cursor]} THEN ${args[cursor + 1]}`);
      cursor += 2;
    }
    out += `CASE ${expr} ${pairs.join(" ")} ELSE ${defaultSql} END`;
    i = close + 1;
  }
  return out;
}

function splitTopLevelArgs(sql: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
      } else if (ch === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Oracle VIEW (c1, c2) AS SELECT expr, expr often leaves duplicate / function names
 * (pk, pk) or (COALESCE(...), COALESCE(...)) which PostgreSQL rejects.
 * Rewrite to SELECT expr AS c1, expr AS c2 and drop the column list.
 */
export function aliasViewSelectToColumnList(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const match =
    /^(CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+)((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s*\(([\s\S]*?)\)\s+AS\s+(SELECT\b[\s\S]+)$/i.exec(
      trimmed,
    );
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return sql.endsWith(";") ? sql : `${trimmed};`;
  }
  const cols = splitTopLevelArgs(match[3])
    .map((part) => {
      const raw = part.replace(/^"/, "").replace(/"$/, "").trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
        return raw.toLowerCase();
      }
      return toPgIdent(raw);
    })
    .filter((part) => part.length > 0);
  const selectMatch =
    /^(SELECT\s+)(DISTINCT\s+|ALL\s+)?([\s\S]+?)(\s+FROM\s+[\s\S]+)$/i.exec(match[4].trim());
  if (!selectMatch?.[1] || !selectMatch[3] || !selectMatch[4] || cols.length === 0) {
    return sql.endsWith(";") ? sql : `${trimmed};`;
  }
  const items = splitTopLevelArgs(selectMatch[3]);
  if (items.length !== cols.length) {
    return sql.endsWith(";") ? sql : `${trimmed};`;
  }
  const aliased = items.map((item, index) => {
    const expression = item.trim();
    const col = cols[index] ?? `col_${index + 1}`;
    let base = expression;
    const asAlias = /\s+AS\s+("[^"]+"|[A-Za-z_][\w$]*)$/i.exec(expression);
    if (asAlias?.index != null) {
      base = expression.slice(0, asAlias.index).trim();
    } else {
      const spaceAlias = /^(.*\S)\s+("[^"]+"|[A-Za-z_][\w$]*)$/.exec(expression);
      if (spaceAlias?.[1]) {
        base = spaceAlias[1].trim();
      }
    }
    return `${base} AS ${col}`;
  });
  return `${match[1]}${match[2]} AS ${selectMatch[1]}${selectMatch[2] ?? ""}${aliased.join(", ")}${selectMatch[4]};`;
}

/** Strip Oracle (+) outer-join markers so the view can compile (joins become inner). */
export function stripOracleOuterJoinMarkers(sql: string): { sql: string; stripped: boolean } {
  const next = sql.replace(/\(\s*\+\s*\)/g, "");
  return { sql: next, stripped: next !== sql };
}

/**
 * Oracle NVL(varchar_col, 0) coerces 0→'0'; PostgreSQL COALESCE does not.
 * Fix common code/lot/po string columns compared to numeric 0.
 */
export function rewriteCoalesceNumericZeroOnStrings(sql: string): string {
  return sql.replace(
    /\bCOALESCE\s*\(\s*((?:[\w"]+\.)*(?:"[^"]+"|[A-Za-z_][\w$]*))\s*,\s*0\s*\)/gi,
    (match, ident: string) => {
      const bare = ident.replace(/"/g, "").split(".").pop()?.toLowerCase() ?? "";
      if (/(?:^|_)(lot_no|po_no|grade|code|cd|nm|no|yn|uom|ccy|status|type)$/.test(bare)) {
        return `COALESCE(${ident}, '0')`;
      }
      return match;
    },
  );
}

/** When a unique index already owns the constraint name, attach it as the PRIMARY KEY. */
export function toPrimaryKeyUsingIndexSql(sql: string): string | null {
  const next = sql.replace(
    /\bADD\s+CONSTRAINT\s+((?:"[^"]+"|[A-Za-z_][\w$]*))\s+PRIMARY\s+KEY\s*\([^)]*\)/gi,
    "ADD CONSTRAINT $1 PRIMARY KEY USING INDEX $1",
  );
  return next === sql ? null : next;
}

/**
 * Oracle allows bare NULL in UNION branches to adopt the other side's type.
 * PostgreSQL often types an uncast NULL as text → "UNION types text and bigint".
 */
export function castBareNullsForUnion(sql: string): string {
  if (!/\bUNION\b/i.test(sql)) {
    return sql;
  }
  let out = "";
  let i = 0;
  while (i < sql.length) {
    if (/^NULL\b/i.test(sql.slice(i))) {
      const before = sql.slice(Math.max(0, i - 12), i);
      const after = sql.slice(i + 4);
      if (!/\bIS\s+$/i.test(before) && !/\bNOT\s+$/i.test(before) && !/^::/.test(after)) {
        out += "NULL::bigint";
        i += 4;
        continue;
      }
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function stripIndexPartitioning(sql: string): string {
  return sql.replace(/\s+\bLOCAL\b(?:\s*\((?:[^()]*|\([^()]*\))*\))?/gi, "");
}

function applyOracleNoise(sql: string): string {
  return stripUsingIndex(stripSqlComments(sql))
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

const PG_IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function qualifyLeadingName(
  sql: string,
  verb: string,
  schema: string,
  ident: string,
): string {
  const pattern = new RegExp(
    `(${verb}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)(?:${PG_IDENT}\\s*\\.\\s*)?${PG_IDENT}`,
    "i",
  );
  return sql.replace(pattern, `$1${schema}.${ident}`);
}

export function ensureTargetSchemaSql(
  sql: string,
  owner: string,
  name: string,
  objectType: OracleObjectType,
): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/CREATE\s+(?:TEMPORARY\s+|TEMP\s+)TABLE\b/i.test(trimmed) && !/CREATE\s+UNLOGGED\s+TABLE\b/i.test(trimmed)) {
    return trimmed.replace(/^\s*CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+[^\n;]+;\s*/i, "");
  }
  const names = qualifiedName(owner, name);
  let next = trimmed.replace(/^\s*SET\s+search_path\s*=\s*[^;]+;\s*/gi, "");
  switch (objectType) {
    case "SEQUENCE":
      next = qualifyLeadingName(next, "CREATE\\s+SEQUENCE", names.schema, names.ident);
      break;
    case "VIEW":
      next = qualifyLeadingName(
        next,
        "CREATE(?:\\s+OR\\s+REPLACE)?\\s+VIEW",
        names.schema,
        names.ident,
      );
      break;
    case "MATERIALIZED_VIEW":
      next = qualifyLeadingName(
        next,
        "CREATE(?:\\s+OR\\s+REPLACE)?\\s+MATERIALIZED\\s+VIEW",
        names.schema,
        names.ident,
      );
      break;
    case "INDEX":
      next = next.replace(
        /\bON\s+(?:ONLY\s+)?(?:("[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/i,
        (_match, _schema: string | undefined, table: string) => `ON ${names.schema}.${table}`,
      );
      break;
    case "CONSTRAINT":
      next = next.replace(
        /(ALTER\s+TABLE\s+(?:ONLY\s+)?)(?:("[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/gi,
        (_match, prefix: string, _schema: string | undefined, table: string) =>
          `${prefix}${names.schema}.${plainTableIdent(table)}`,
      );
      break;
    case "TABLE":
      next = qualifyLeadingName(
        next,
        "CREATE\\s+(?:UNLOGGED\\s+)?TABLE",
        names.schema,
        names.ident,
      );
      next = next.replace(
        /(ALTER\s+TABLE\s+(?:ONLY\s+)?)(?:("[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/gi,
        `$1${names.qualified}`,
      );
      break;
    default:
      break;
  }
  const header = `CREATE SCHEMA IF NOT EXISTS ${names.schema};`;
  if (
    !new RegExp(
      `CREATE\\s+SCHEMA\\s+IF\\s+NOT\\s+EXISTS\\s+${escapeRegExp(names.schema)}\\b`,
      "i",
    ).test(next)
  ) {
    return `${header}\n${next}`;
  }
  return next;
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

function isTableFollowOnAlter(sql: string): boolean {
  if (!/^\s*ALTER\s+TABLE\b/i.test(sql)) {
    return false;
  }
  return (
    /\bADD\s+CONSTRAINT\b/i.test(sql) ||
    /\bADD\s+(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(sql) ||
    /\bADD\s*\(/i.test(sql) ||
    /\bADD\s+(?:"[^"]+"|[A-Za-z_][\w$]*)\s+/i.test(sql)
  );
}

function takeLeadingCreateTable(sql: string): string {
  if (!/^\s*CREATE\s+(?:UNLOGGED\s+)?(?:GLOBAL\s+)?(?:TEMPORARY\s+|TEMP\s+)?TABLE\b/i.test(sql)) {
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
    .filter((part) => part.length > 0 && isTableFollowOnAlter(part));
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
      return mapOracleDataType(`NUMBER(${column.dataPrecision})`) ?? "numeric";
    }
    return mapOracleDataType("NUMBER") ?? "numeric";
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

function columnHasNotNull(sql: string, columnName: string): boolean {
  const ident = toPgIdent(columnName).replace(/^"|"$/g, "");
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[\\s,(])"?${escaped}"?\\s+(?:[\\w"()]+(?:\\s*\\([^)]*\\))?)(?:\\s+[^,)]*)*\\bNOT\\s+NULL\\b`,
    "i",
  ).test(sql);
}

function appendCatalogNotNull(
  sql: string,
  owner: string,
  name: string,
  columns: Array<{ name: string; nullable: boolean }>,
): { sql: string; added: string[] } {
  if (columns.length === 0 || !/create\s+(?:unlogged\s+)?(?:temporary\s+|temp\s+)?table\b/i.test(sql)) {
    return { sql, added: [] };
  }
  const names = qualifiedName(owner, name);
  const added: string[] = [];
  const statements: string[] = [];
  for (const column of columns) {
    if (column.nullable || !sqlHasColumn(sql, column.name) || columnHasNotNull(sql, column.name)) {
      continue;
    }
    added.push(toPgIdent(column.name));
    statements.push(
      `ALTER TABLE ${names.qualified} ALTER COLUMN ${toPgIdent(column.name)} SET NOT NULL;`,
    );
  }
  if (statements.length === 0) {
    return { sql, added };
  }
  return { sql: `${sql.replace(/;+\s*$/, "")};\n${statements.join("\n")}`, added };
}

export function mergeConstraintAlters(baseSql: string, sourceSql: string): string {
  const alters = [...sourceSql.matchAll(/ALTER\s+TABLE[\s\S]*?\bADD\s+CONSTRAINT\b[\s\S]*?(?=;|$)/gi)].map(
    (match) => match[0].trim().replace(/;+\s*$/, ""),
  );
  let next = baseSql.trim();
  for (const alter of alters) {
    const nameMatch = /\bADD\s+CONSTRAINT\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))/i.exec(alter);
    const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? "").toLowerCase();
    if (name && next.toLowerCase().includes(name)) {
      continue;
    }
    next = `${next.replace(/;+\s*$/, "")};\n${alter};`;
  }
  return next;
}

/**
 * Force column types from Oracle ALL_TAB_COLUMNS onto CREATE TABLE SQL.
 * Needed when Ora2Pg CLI emits bigint/integer for NUMBER(p[,0]) while live data is fractional.
 */
export function rewriteCatalogColumnTypes(
  sql: string,
  columns: Array<{
    name: string;
    dataType: string;
    dataLength: number | null;
    dataPrecision: number | null;
    dataScale: number | null;
  }>,
): { sql: string; rewritten: string[] } {
  if (columns.length === 0 || !/create\s+(?:unlogged\s+)?(?:temporary\s+|temp\s+)?table\b/i.test(sql)) {
    return { sql, rewritten: [] };
  }
  let next = sql;
  const rewritten: string[] = [];
  const typeToken =
    String.raw`(?:double\s+precision|character\s+varying|character|timestamp(?:\s+with(?:out)?\s+time\s+zone)?|time(?:\s+with(?:out)?\s+time\s+zone)?|[a-zA-Z_][\w]*)(?:\s*\(\s*[^)]+\s*\))?`;
  for (const column of columns) {
    const ident = toPgIdent(column.name).replace(/^"|"$/g, "");
    const desired = oracleCatalogType(column);
    const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `((?:^|[\\s,(])(?:"${escaped}"|${escaped})\\s+)(${typeToken})`,
      "i",
    );
    const match = re.exec(next);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const current = match[2].replace(/\s+/g, " ").trim().toLowerCase();
    const want = desired.replace(/\s+/g, " ").trim().toLowerCase();
    if (current === want) {
      continue;
    }
    next = `${next.slice(0, match.index)}${match[1]}${desired}${next.slice(match.index + match[0].length)}`;
    rewritten.push(`${ident}: ${current} → ${want}`);
  }
  return { sql: next, rewritten };
}

export function applyCatalogColumnPatches(
  sql: string,
  owner: string,
  name: string,
  columns: DiscoveredColumn[],
): { sql: string; added: string[]; notNull: string[]; rewrittenTypes: string[] } {
  const typed = rewriteCatalogColumnTypes(sql, columns);
  const missing = appendMissingCatalogColumns(typed.sql, owner, name, columns);
  const notNull = appendCatalogNotNull(missing.sql, owner, name, columns);
  return {
    sql: notNull.sql,
    added: missing.added,
    notNull: notNull.added,
    rewrittenTypes: typed.rewritten,
  };
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
  if (columns.length === 0 || !/create\s+(?:unlogged\s+)?(?:temporary\s+|temp\s+)?table\b/i.test(sql)) {
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
  qualified: string,
): { sql: string; gtt: boolean } {
  if (!/CREATE\s+(?:GLOBAL\s+)?TEMPORARY\s+TABLE/i.test(sql)) {
    return { sql, gtt: false };
  }
  return {
    sql: sql
      .replace(
        /CREATE\s+(?:GLOBAL\s+)?TEMPORARY\s+TABLE\s+(?:"[^"]+"|[A-Z0-9_]+)(?:\s*\.\s*(?:"[^"]+"|[A-Z0-9_]+))?/i,
        `CREATE UNLOGGED TABLE ${qualified}`,
      )
      .replace(/\s+ON\s+COMMIT\s+(?:DELETE|PRESERVE)\s+ROWS/gi, ""),
    gtt: true,
  };
}

function finish(
  result: Omit<ConversionResult, "mappingRulesVersion" | "converterType">,
  objectType: OracleObjectType,
  owner?: string,
  name?: string,
): ConversionResult {
  const riskFlags = [...new Set(result.riskFlags)];
  const riskLevel = result.riskLevel === "LOW" ? riskLevelFor(riskFlags) : result.riskLevel;
  const viewLike =
    String(objectType).toUpperCase() === "VIEW" ||
    String(objectType).toUpperCase() === "MATERIALIZED_VIEW";
  // Views are rule-converted like schema objects: only HIGH-risk constructs (CONNECT BY,
  // DBMS_*, …) force REVIEW. Medium warnings must not block VALIDATED after compile/tests.
  const forceReview = viewLike
    ? riskLevel === "HIGH"
    : !isDeterministicSchemaType(objectType) && (riskLevel === "HIGH" || riskFlags.length > 0);
  const status: ConversionAttemptStatus =
    result.status === "FAILED"
      ? "FAILED"
      : result.status === "REVIEW_REQUIRED" || forceReview
        ? "REVIEW_REQUIRED"
        : result.status;
  const sql =
    result.sql && owner && name
      ? ensureTargetSchemaSql(result.sql, owner, name, objectType)
      : result.sql;
  return {
    ...result,
    sql,
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
  }, "SEQUENCE", owner, name);
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
  sql = stripIndexPartitioning(sql);
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
  }, "INDEX", owner, name);
}

function convertConstraint(
  source: string,
  owner: string,
  name: string,
  tableName?: string,
): ConversionResult {
  const names = qualifiedName(owner, name);
  const warnings: string[] = [];
  let sql = applyOracleNoise(source);
  sql = rewriteIdentifiers(sql);
  sql = mapTypesInSql(sql);
  const table = tableName?.trim() ? qualifiedName(owner, tableName) : null;
  if (table) {
    sql = sql.replace(
      /(ALTER\s+TABLE\s+(?:ONLY\s+)?)(?:("[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/i,
      `$1${table.qualified}`,
    );
  }
  // PostgreSQL: PK backing index shares pg_class with tables/indexes in the schema.
  // Oracle often names a PK after a sibling live table (e.g. TCO_ABCODE on TCO_ABCODE_NO_USE)
  // or after the table itself — both collide. Prefer {table}_pkey.
  const tableIdent =
    table?.ident ??
    (/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:[\w"]+\.)?([\w"]+)/i.exec(sql)?.[1]
      ?.replace(/"/g, "")
      .toLowerCase() ?? null);
  const pkMatch =
    /\bADD\s+CONSTRAINT\s+((?:"[^"]+"|[A-Za-z_][\w$]*))\s+PRIMARY\s+KEY\s*\(/i.exec(sql);
  if (tableIdent && pkMatch) {
    const current = (pkMatch[1] ?? "").replace(/"/g, "").toLowerCase();
    const renamed = `${tableIdent}_pkey`;
    if (current !== renamed) {
      sql = sql.replace(
        new RegExp(`\\bADD\\s+CONSTRAINT\\s+${escapeRegExp(pkMatch[1] ?? current)}\\b`, "i"),
        `ADD CONSTRAINT ${renamed}`,
      );
      warnings.push(
        `Renamed PRIMARY KEY constraint ${current} → ${renamed} (avoid PostgreSQL relation name collision)`,
      );
    }
  }
  sql = ensureSemicolon(sql);
  return finish(
    {
      sql: `CREATE SCHEMA IF NOT EXISTS ${names.schema};\n${sql}`,
      warnings,
      riskFlags: detectRiskFlags(source),
      riskLevel: "LOW",
      status: "SUCCEEDED",
      targetSchema: names.schema,
      targetName: names.ident,
      errorMessage: null,
    },
    "CONSTRAINT",
    owner,
    name,
  );
}

function convertTableOrConstraint(
  source: string,
  owner: string,
  name: string,
  columns: DiscoveredColumn[] = [],
  objectType: "TABLE" = "TABLE",
): ConversionResult {
  const names = qualifiedName(owner, name);
  const riskFlags = detectRiskFlags(source);
  const warnings: string[] = [];
  if (/\bVIRTUAL\b/i.test(source)) {
    warnings.push("Virtual columns may need a generated-column rewrite");
    riskFlags.push("VIRTUAL");
  }
  const gtt = rewriteGlobalTemporaryTable(source, names.qualified);
  if (gtt.gtt) {
    warnings.push(
      "Oracle GLOBAL TEMPORARY TABLE mapped to UNLOGGED TABLE in the owner schema",
    );
  }
  let sql = applyOracleNoise(gtt.sql);
  sql = sql.replace(/\s+NOCACHE\b/gi, "").replace(/\s+\bCACHE\b/gi, "");
  sql = rewriteIdentifiers(sql);
  sql = mapTypesInSql(sql);
  sql = rewriteSequenceNextval(sql);
  sql = takeLeadingCreateTable(sql);
  const partitioned = stripOraclePartitionClause(sql);
  if (partitioned.stripped) {
    warnings.push("Oracle PARTITION BY clause stripped; table is a regular heap table");
    sql = partitioned.sql;
  }
  sql = ensureSemicolon(sql);
  const patched = applyCatalogColumnPatches(sql, owner, name, columns);
  if (patched.rewrittenTypes.length > 0) {
    warnings.push(
      `Aligned column types with Oracle catalog (${patched.rewrittenTypes.join("; ")})`,
    );
  }
  if (patched.added.length > 0) {
    warnings.push(
      `Oracle catalog has columns missing from extracted DDL; added ${patched.added.join(", ")}`,
    );
  }
  if (patched.notNull.length > 0) {
    warnings.push(`Preserved Oracle NOT NULL on ${patched.notNull.join(", ")}`);
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
  }, objectType, owner, name);
}

function convertView(source: string, owner: string, name: string): ConversionResult {
  const names = qualifiedName(owner, name);
  const riskFlags = detectRiskFlags(source);
  const warnings: string[] = [];
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
  if (/\bDECODE\s*\(/i.test(sql)) {
    sql = rewriteDecode(sql);
    warnings.push("DECODE rewritten to CASE");
  }
  const outer = stripOracleOuterJoinMarkers(sql);
  if (outer.stripped) {
    sql = outer.sql;
    warnings.push(
      "Oracle (+) outer-join markers removed; joins compile as inner joins until a full LEFT JOIN rewrite",
    );
  }
  sql = rewriteCoalesceNumericZeroOnStrings(sql);
  const beforeNullCast = sql;
  sql = castBareNullsForUnion(sql);
  if (sql !== beforeNullCast) {
    warnings.push("Cast bare NULL to NULL::bigint inside UNION branches for PostgreSQL type matching");
  }
  const beforeAlias = sql;
  sql = aliasViewSelectToColumnList(sql);
  if (sql !== beforeAlias) {
    warnings.push("Aliased VIEW SELECT expressions to the Oracle column list for PostgreSQL");
  }
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
  }, "VIEW", owner, name);
}

export function convertOracleDdl(input: {
  objectType: OracleObjectType;
  owner: string;
  name: string;
  sourceText: string | null;
  columns?: DiscoveredColumn[];
  tableName?: string;
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
    }, input.objectType, input.owner, input.name);
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
    }, input.objectType, input.owner, input.name);
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
        return convertTableOrConstraint(
          input.sourceText,
          input.owner,
          input.name,
          input.columns ?? [],
          "TABLE",
        );
      case "CONSTRAINT":
        return convertConstraint(input.sourceText, input.owner, input.name, input.tableName);
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
    }, input.objectType, input.owner, input.name);
  }
}
