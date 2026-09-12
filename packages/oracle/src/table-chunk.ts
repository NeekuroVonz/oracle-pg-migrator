import { AppError } from "@migrator/shared";

const MAX_IDENT_LENGTH = 128;
const MAX_COLUMNS = 1000;
const MAX_OFFSET = 1_000_000_000;
const MAX_LIMIT = 5000;

export function quoteOracleIdent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IDENT_LENGTH) {
    throw new AppError("VALIDATION_ERROR", "Invalid Oracle identifier");
  }
  return `"${trimmed.replaceAll('"', '""')}"`;
}

export function requireNonNegativeInt(value: number, label: string, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new AppError("VALIDATION_ERROR", `Invalid ${label}`);
  }
  return value;
}

export function buildTableCountSql(owner: string, name: string): string {
  return `SELECT COUNT(*) FROM ${quoteOracleIdent(owner)}.${quoteOracleIdent(name)}`;
}

export function buildTableChunkSql(input: {
  owner: string;
  name: string;
  columns: string[];
  offset: number;
  limit: number;
}): string {
  if (input.columns.length === 0 || input.columns.length > MAX_COLUMNS) {
    throw new AppError("VALIDATION_ERROR", "Table chunk requires a column list");
  }
  const offset = requireNonNegativeInt(input.offset, "offset", MAX_OFFSET);
  const limit = requireNonNegativeInt(input.limit, "limit", MAX_LIMIT);
  if (limit < 1) {
    throw new AppError("VALIDATION_ERROR", "Invalid limit");
  }
  const columns = input.columns.map((column) => quoteOracleIdent(column)).join(", ");
  return (
    `SELECT ${columns} FROM ${quoteOracleIdent(input.owner)}.${quoteOracleIdent(input.name)} ` +
    `ORDER BY ROWID OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  );
}
