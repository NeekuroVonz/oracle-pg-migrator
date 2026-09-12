import { OracleReadOnlyViolationError } from "@migrator/shared";

export type OracleSqlKind = "SELECT" | "REJECTED";

export interface OracleSqlClassification {
  kind: OracleSqlKind;
  reason: string;
  leadingKeyword: string | null;
  statementCount: number;
  normalizedSql: string;
}

const SELECT_INTO = /\bINTO\b/i;
const FOR_UPDATE = /\bFOR\s+UPDATE\b/i;

const DML_DDL_KEYWORDS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "TRUNCATE",
  "ALTER",
  "DROP",
  "CREATE",
  "GRANT",
  "REVOKE",
  "BEGIN",
  "DECLARE",
  "CALL",
  "EXEC",
  "EXECUTE",
  "EXPLAIN",
  "LOCK",
  "ANALYZE",
  "COMMENT",
  "FLASHBACK",
  "PURGE",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "SET",
  "RENAME",
  "AUDIT",
  "NOAUDIT",
  "ASSOCIATE",
  "DISASSOCIATE",
  "ADMINISTER",
  "REPLACE",
]);

export function stripOracleCommentsAndNormalize(sql: string): string {
  let output = "";
  let i = 0;
  const length = sql.length;

  while (i < length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "-" && next === "-") {
      i += 2;
      while (i < length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      output += " ";
      continue;
    }

    if (char === "'") {
      output += char;
      i += 1;
      while (i < length) {
        output += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          output += sql[i + 1];
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (char === '"') {
      output += char;
      i += 1;
      while (i < length) {
        output += sql[i];
        if (sql[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if ((char === "q" || char === "Q") && next === "'") {
      const opener = sql[i + 2];
      const closer = qQuoteCloser(opener);
      if (closer !== null) {
        output += sql.slice(i, i + 3);
        i += 3;
        while (i < length - 1) {
          output += sql[i];
          if (sql[i] === closer && sql[i + 1] === "'") {
            output += "'";
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
    }

    output += char;
    i += 1;
  }

  return output.replace(/\s+/g, " ").trim();
}

function qQuoteCloser(opener: string | undefined): string | null {
  switch (opener) {
    case "[":
      return "]";
    case "{":
      return "}";
    case "<":
      return ">";
    case "(":
      return ")";
    default:
      return opener ?? null;
  }
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "'" && !inDouble) {
      if (inSingle && sql[i + 1] === "'") {
        current += "''";
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === ";" && !inSingle && !inDouble) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }
  return statements;
}

function leadingKeyword(sql: string): string | null {
  const match = sql.match(/^([A-Za-z_]+)/);
  return match?.[1]?.toUpperCase() ?? null;
}

function withClauseMainKeyword(sql: string): string | null {
  const upper = sql.toUpperCase();
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < upper.length) {
    const char = upper[i];
    if (char === "'" && !inDouble) {
      if (inSingle && upper[i + 1] === "'") {
        i += 2;
        continue;
      }
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }
    if (inSingle || inDouble) {
      i += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0) {
      const rest = upper.slice(i);
      const keywordMatch = rest.match(/^(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/);
      if (keywordMatch?.[1] && i > 0) {
        return keywordMatch[1];
      }
    }
    i += 1;
  }
  return null;
}

export function classifyOracleSql(sql: string): OracleSqlClassification {
  const stripped = stripOracleCommentsAndNormalize(sql);
  if (!stripped) {
    return {
      kind: "REJECTED",
      reason: "empty statement",
      leadingKeyword: null,
      statementCount: 0,
      normalizedSql: "",
    };
  }

  const statements = splitStatements(stripped);
  if (statements.length !== 1) {
    return {
      kind: "REJECTED",
      reason: "multiple statements are not allowed",
      leadingKeyword: leadingKeyword(statements[0] ?? ""),
      statementCount: statements.length,
      normalizedSql: stripped,
    };
  }

  const statement = statements[0] ?? "";
  const keyword = leadingKeyword(statement);
  if (!keyword) {
    return {
      kind: "REJECTED",
      reason: "unable to classify statement",
      leadingKeyword: null,
      statementCount: 1,
      normalizedSql: statement,
    };
  }

  if (DML_DDL_KEYWORDS.has(keyword) || keyword === "ANONYMOUS") {
    return {
      kind: "REJECTED",
      reason: `${keyword} is not allowed against Oracle`,
      leadingKeyword: keyword,
      statementCount: 1,
      normalizedSql: statement,
    };
  }

  if (keyword === "WITH") {
    const main = withClauseMainKeyword(statement);
    if (main !== "SELECT") {
      return {
        kind: "REJECTED",
        reason: `WITH must be followed by SELECT, found ${main ?? "nothing classifiable"}`,
        leadingKeyword: keyword,
        statementCount: 1,
        normalizedSql: statement,
      };
    }
  } else if (keyword !== "SELECT") {
    return {
      kind: "REJECTED",
      reason: `${keyword} is not a SELECT-compatible statement`,
      leadingKeyword: keyword,
      statementCount: 1,
      normalizedSql: statement,
    };
  }

  if (SELECT_INTO.test(statement)) {
    return {
      kind: "REJECTED",
      reason: "SELECT INTO is PL/SQL and is not allowed",
      leadingKeyword: keyword,
      statementCount: 1,
      normalizedSql: statement,
    };
  }

  if (FOR_UPDATE.test(statement)) {
    return {
      kind: "REJECTED",
      reason: "SELECT FOR UPDATE is not allowed",
      leadingKeyword: keyword,
      statementCount: 1,
      normalizedSql: statement,
    };
  }

  return {
    kind: "SELECT",
    reason: "single SELECT-compatible statement",
    leadingKeyword: keyword,
    statementCount: 1,
    normalizedSql: statement,
  };
}

export function assertOracleSelect(sql: string): OracleSqlClassification {
  const classification = classifyOracleSql(sql);
  if (classification.kind !== "SELECT") {
    throw new OracleReadOnlyViolationError(
      `Oracle read-only client rejected SQL: ${classification.reason}`,
      classification,
    );
  }
  return classification;
}
