export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
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
    if (ch === "-" && next === "-" && !inSingle && !inDouble) {
      while (i < sql.length && sql[i] !== "\n") {
        i += 1;
      }
      current += "\n";
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  return statements;
}

export interface CompileDiagnostic {
  statement: string;
  code: string | null;
  message: string;
  position: number | null;
}

export interface CompileResult {
  ok: boolean;
  statements: number;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  diagnostics: CompileDiagnostic[];
}

export interface SqlExecutor {
  query(sql: string): Promise<unknown>;
}

export interface CompileSqlOptions {
  ignoreDuplicateObjects?: boolean;
}

function isDuplicateCodeOrMessage(code?: string | null, message?: string | null): boolean {
  if (code === "42P07" || code === "42710" || code === "42723") {
    return true;
  }
  return Boolean(message && /already exists/i.test(message));
}

export function isDuplicateObjectError(input: {
  code?: string | null;
  errorCode?: string | null;
  message?: string | null;
  errorMessage?: string | null;
  diagnostics?: Array<{ code?: string | null; message?: string | null }>;
}): boolean {
  if (isDuplicateCodeOrMessage(input.code ?? input.errorCode, input.message ?? input.errorMessage)) {
    return true;
  }
  return (
    input.diagnostics?.some((item) => isDuplicateCodeOrMessage(item.code, item.message)) ?? false
  );
}

export async function compileSql(
  executor: SqlExecutor,
  sql: string,
  timeoutMs = 15000,
  options: CompileSqlOptions = {},
): Promise<CompileResult> {
  const started = Date.now();
  const statements = splitSqlStatements(sql);
  const diagnostics: CompileDiagnostic[] = [];
  if (statements.length === 0) {
    return {
      ok: false,
      statements: 0,
      durationMs: Date.now() - started,
      errorCode: "EMPTY_SQL",
      errorMessage: "No SQL to compile",
      diagnostics,
    };
  }
  await executor.query(`SET statement_timeout = ${Math.max(1000, Math.floor(timeoutMs))}`);
  for (const statement of statements) {
    try {
      await executor.query(statement);
    } catch (error) {
      const pgError = error as { code?: string; message?: string; position?: string };
      const diagnostic: CompileDiagnostic = {
        statement,
        code: pgError.code ?? null,
        message: pgError.message ?? (error instanceof Error ? error.message : "compile failed"),
        position: pgError.position ? Number(pgError.position) : null,
      };
      if (options.ignoreDuplicateObjects && isDuplicateCodeOrMessage(diagnostic.code, diagnostic.message)) {
        continue;
      }
      diagnostics.push(diagnostic);
    }
  }
  const first = diagnostics[0];
  return {
    ok: diagnostics.length === 0,
    statements: statements.length,
    durationMs: Date.now() - started,
    errorCode: first?.code ?? null,
    errorMessage: first?.message ?? null,
    diagnostics,
  };
}
