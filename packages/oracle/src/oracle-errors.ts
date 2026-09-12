export function isMissingOracleDictionary(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /ORA-00942|ORA-01031|ORA-00904/i.test(message);
}

export function catalogViewName(sql: string): string | null {
  const match = sql.match(/\bFROM\s+"?([A-Z][A-Z0-9_$]*)"?/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export function wrapOracleQueryError(sql: string, error: unknown): Error {
  const view = catalogViewName(sql);
  const message = error instanceof Error ? error.message : String(error);
  if (view && message.startsWith(`${view}:`)) {
    return error instanceof Error ? error : new Error(message);
  }
  const wrapped = new Error(view ? `${view}: ${message}` : message);
  wrapped.cause = error;
  return wrapped;
}
