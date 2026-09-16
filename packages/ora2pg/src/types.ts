/**
 * Ora2Pg-compatible type mapping (DATA_TYPE / PG_INTEGER_TYPE / DEFAULT_NUMERIC).
 * Source: https://ora2pg.darold.net/docs/configuration/type-control
 */

export interface ParsedOracleType {
  name: string;
  precision: number | null;
  scale: number | null;
  length: number | null;
  starPrecision: boolean;
  qualifier: "BYTE" | "CHAR" | null;
  withTimeZone: boolean;
  localTimeZone: boolean;
  timestampPrecision: number | null;
}

const TYPE_NAMES =
  "LONG\\s+RAW|DOUBLE\\s+PRECISION|TIMESTAMP|BINARY_DOUBLE|BINARY_FLOAT|BINARY_INTEGER|PLS_INTEGER|NVARCHAR2|NVARCHAR|VARCHAR2|VARCHAR|NUMBER|NUMERIC|DECIMAL|XMLTYPE|UROWID|ROWID|NCLOB|CLOB|BLOB|BFILE|NCHAR|CHAR|DATE|FLOAT|DEC|INTEGER|SMALLINT|BOOLEAN|INT|RAW";

const TYPE_RE = new RegExp(
  `^(${TYPE_NAMES})(?:\\s*\\(\\s*(\\*|\\d+)(?:\\s+(BYTE|CHAR))?(?:\\s*,\\s*(\\*|\\d+))?\\s*\\))?(?:\\s+WITH(\\s+LOCAL)?\\s+TIME\\s+ZONE)?(?:\\s+(BYTE|CHAR))?$`,
  "i",
);

export function parseOracleDataType(raw: string): ParsedOracleType | null {
  const normalized = raw.trim().replace(/\s+/g, " ");
  const match = TYPE_RE.exec(normalized);
  if (!match) {
    return null;
  }
  const name = match[1]?.replace(/\s+/g, " ").toUpperCase() ?? "";
  const first = match[2];
  const innerQual = match[3];
  const second = match[4];
  const localTz = Boolean(match[5]);
  const outerQual = match[6];
  const withTz = /WITH(?:\s+LOCAL)?\s+TIME\s+ZONE/i.test(normalized);
  const qualRaw = (innerQual ?? outerQual)?.toUpperCase();
  const qualifier = qualRaw === "CHAR" ? "CHAR" : qualRaw === "BYTE" ? "BYTE" : null;
  const starPrecision = first === "*";
  const precision = first && first !== "*" ? Number(first) : null;
  const scale = second && second !== "*" ? Number(second) : second === "*" ? null : null;
  const isTimestamp = name === "TIMESTAMP";
  return {
    name,
    precision: isTimestamp ? null : precision,
    scale: isTimestamp ? null : scale,
    length: lengthType(name) ? precision : null,
    starPrecision,
    qualifier,
    withTimeZone: withTz,
    localTimeZone: localTz,
    timestampPrecision: isTimestamp ? precision : null,
  };
}

function lengthType(name: string): boolean {
  return (
    name === "VARCHAR2" ||
    name === "NVARCHAR2" ||
    name === "NVARCHAR" ||
    name === "VARCHAR" ||
    name === "CHAR" ||
    name === "NCHAR" ||
    name === "RAW"
  );
}

export function mapOracleDataType(raw: string): string | null {
  const parsed = parseOracleDataType(raw);
  if (!parsed) {
    return null;
  }
  switch (parsed.name) {
    case "VARCHAR2":
    case "NVARCHAR2":
    case "NVARCHAR":
    case "VARCHAR":
      return parsed.length != null ? `varchar(${parsed.length})` : "text";
    case "CHAR":
    case "NCHAR":
      return parsed.length != null ? `char(${parsed.length})` : "char";
    case "CLOB":
    case "NCLOB":
    case "LONG":
      return "text";
    case "BLOB":
    case "BFILE":
    case "LONG RAW":
      return "bytea";
    case "RAW":
      if (parsed.length === 16 || parsed.length === 32) {
        return "uuid";
      }
      return "bytea";
    case "DATE":
      return "timestamp";
    case "TIMESTAMP": {
      const precision = parsed.timestampPrecision != null ? `(${parsed.timestampPrecision})` : "";
      if (parsed.withTimeZone) {
        return `timestamp${precision} with time zone`;
      }
      return `timestamp${precision}`;
    }
    case "NUMBER":
    case "NUMERIC":
    case "DECIMAL":
    case "DEC":
      return mapNumberType(parsed);
    case "FLOAT":
    case "BINARY_FLOAT":
    case "BINARY_DOUBLE":
    case "DOUBLE PRECISION":
      return "double precision";
    case "REAL":
      return "real";
    case "INT":
    case "INTEGER":
    case "BINARY_INTEGER":
    case "PLS_INTEGER":
      return "integer";
    case "SMALLINT":
      return "smallint";
    case "BOOLEAN":
      return "boolean";
    case "XMLTYPE":
      return "xml";
    case "UROWID":
    case "ROWID":
      return "oid";
    default: {
      const exhaustive: never = parsed.name as never;
      return exhaustive;
    }
  }
}

function mapNumberType(parsed: ParsedOracleType): string {
  if (parsed.starPrecision) {
    return "numeric";
  }
  const scale = parsed.scale;
  const precision = parsed.precision;
  // Bare NUMBER/NUMERIC/DECIMAL (no precision) is arbitrary scale in Oracle — never bigint.
  if (precision == null && scale == null) {
    return "numeric";
  }
  if (precision != null && scale != null && scale > 0) {
    return `numeric(${precision},${scale})`;
  }
  if (precision != null && (scale == null || scale === 0)) {
    // Prefer numeric over smallint/integer/bigint — Oracle NUMBER often holds fractions
    // and TARGET may already be widened by data-copy.
    return `numeric(${precision})`;
  }
  return "numeric";
}

export const ORACLE_TYPE_PATTERN = new RegExp(
  // Bare DEC is a common column name (December) — only map DEC(...).
  `\\b(?:${TYPE_NAMES.replace(/\|DEC\|/i, "|").replace(/\|DEC$/i, "")})(?![A-Za-z0-9_])(?:\\s*\\(\\s*(?:\\*|\\d+)(?:\\s+(?:BYTE|CHAR))?(?:\\s*,\\s*(?:\\*|\\d+))?\\s*\\))?(?:\\s+WITH(?:\\s+LOCAL)?\\s+TIME\\s+ZONE)?(?:\\s+(?:BYTE|CHAR))?|\\bDEC\\s*\\(\\s*(?:\\*|\\d+)(?:\\s*,\\s*(?:\\*|\\d+))?\\s*\\)`,
  "gi",
);
