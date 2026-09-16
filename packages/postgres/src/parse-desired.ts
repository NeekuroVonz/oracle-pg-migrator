import {
  canonicalizeIdent,
  type PgColumnShape,
  type PgConstraintShape,
  type PgObjectShape,
} from "@migrator/shared";

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
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

function splitTopLevel(sql: string, delimiter: string): string[] {
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
      } else if (ch === delimiter && depth === 0) {
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

function qualified(raw: string): { schema: string | null; name: string } {
  const match =
    /^(?:"([^"]+)"|([a-zA-Z_][\w$]*))(?:\s*\.\s*(?:"([^"]+)"|([a-zA-Z_][\w$]*)))?$/.exec(
      raw.trim(),
    );
  if (!match) {
    return { schema: null, name: canonicalizeIdent(raw) };
  }
  if (match[3] || match[4]) {
    return {
      schema: canonicalizeIdent(match[1] ?? match[2] ?? ""),
      name: canonicalizeIdent(match[3] ?? match[4] ?? ""),
    };
  }
  return { schema: null, name: canonicalizeIdent(match[1] ?? match[2] ?? raw) };
}

function parseColumn(fragment: string): PgColumnShape | null {
  const match = /^(?:"([^"]+)"|([a-zA-Z_][\w$]*))\s+(.+)$/i.exec(fragment.trim());
  if (!match) {
    return null;
  }
  const name = canonicalizeIdent(match[1] ?? match[2] ?? "");
  let rest = (match[3] ?? "").trim();
  // Do not let NOT NULL / DEFAULT get swallowed into the type token.
  const typeMatch =
    /^(double\s+precision|character\s+varying|character|timestamp(?:\s+with(?:out)?\s+time\s+zone)?|time(?:\s+with(?:out)?\s+time\s+zone)?|[a-zA-Z_][\w]*)(?:\s*\(\s*[^)]+\s*\))?/i.exec(
      rest,
    );
  if (!typeMatch?.[0]) {
    return null;
  }
  const type = typeMatch[0].trim();
  rest = rest.slice(typeMatch[0].length);
  const nullable = !/\bNOT\s+NULL\b/i.test(rest);
  const defaultMatch = /\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s*$)/i.exec(rest);
  return {
    name,
    type,
    nullable,
    default: defaultMatch?.[1]?.trim() ?? null,
  };
}

function parseConstraint(fragment: string): PgConstraintShape | null {
  const named =
    /^CONSTRAINT\s+(?:"([^"]+)"|([a-zA-Z_][\w$]*))\s+(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\s*(.*)$/i.exec(
      fragment.trim(),
    );
  const unnamed = /^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\s*(.*)$/i.exec(fragment.trim());
  const match = named ?? unnamed;
  if (!match) {
    return null;
  }
  const name = named ? canonicalizeIdent(named[1] ?? named[2] ?? "constraint") : "constraint";
  const kindRaw = (named?.[3] ?? unnamed?.[1] ?? "CHECK").toUpperCase().replace(/\s+/g, " ");
  const rest = (named?.[4] ?? unnamed?.[2] ?? "").trim();
  const kind =
    kindRaw === "PRIMARY KEY"
      ? "PRIMARY KEY"
      : kindRaw === "UNIQUE"
        ? "UNIQUE"
        : kindRaw === "FOREIGN KEY"
          ? "FOREIGN KEY"
          : "CHECK";
  const cols =
    /\(([^)]*)\)/
      .exec(rest)?.[1]
      ?.split(",")
      .map((part) => canonicalizeIdent(part.trim()))
      .filter(Boolean) ?? [];
  const ref = /REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(rest);
  const referenced = ref ? qualified(ref[1] ?? "") : { schema: null, name: "" };
  return {
    name,
    kind,
    columns: cols,
    definition: fragment.trim(),
    referencedSchema: referenced.schema,
    referencedTable: ref ? referenced.name : null,
    referencedColumns: ref
      ? (ref[2] ?? "")
          .split(",")
          .map((part) => canonicalizeIdent(part.trim()))
          .filter(Boolean)
      : [],
  };
}

function pickPrimaryStatement(objectType: string, statements: string[]): string {
  const find = (pattern: RegExp) => statements.find((statement) => pattern.test(statement));
  switch (objectType) {
    case "TABLE":
      return find(/^CREATE\s+(?:UNLOGGED\s+)?(?:TEMPORARY\s+|TEMP\s+)?TABLE\b/i) ?? statements.join(";\n");
    case "INDEX":
      return find(/^CREATE\s+(UNIQUE\s+)?INDEX\b/i) ?? statements.join(";\n");
    case "SEQUENCE":
      return find(/^CREATE\s+SEQUENCE\b/i) ?? statements.join(";\n");
    case "VIEW":
      return (
        find(/^CREATE\s+(OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?VIEW\b/i) ?? statements.join(";\n")
      );
    case "MATERIALIZED_VIEW":
      return find(/^CREATE\s+MATERIALIZED\s+VIEW\b/i) ?? statements.join(";\n");
    case "CONSTRAINT":
      return find(/^ALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b/i) ?? statements.join(";\n");
    case "FUNCTION":
      return find(/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i) ?? statements.join(";\n");
    case "PROCEDURE":
      return find(/^CREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i) ?? statements.join(";\n");
    case "TRIGGER":
      return find(/^CREATE\s+(OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b/i) ?? statements.join(";\n");
    default:
      return statements.join(";\n");
  }
}

function applyTableFollowOns(
  shape: Extract<PgObjectShape, { kind: "table" }>,
  statements: string[],
): void {
  for (const statement of statements) {
    const notNull =
      /ALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\s+(?:"([^"]+)"|([a-zA-Z_][\w$]*))\s+SET\s+NOT\s+NULL/i.exec(
        statement,
      );
    if (notNull) {
      const columnName = canonicalizeIdent(notNull[1] ?? notNull[2] ?? "");
      const column = shape.columns.find((item) => item.name === columnName);
      if (column) {
        column.nullable = false;
      }
      continue;
    }
    const added = parseConstraintObject(statement, shape.schema, shape.name);
    if (added?.kind === "constraint") {
      const exists = shape.constraints.some(
        (item) => canonicalizeIdent(item.name) === canonicalizeIdent(added.constraint.name),
      );
      if (!exists) {
        shape.constraints.push(added.constraint);
      }
    }
  }
}

function parseTable(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
): PgObjectShape | null {
  const match =
    /CREATE\s+(?:UNLOGGED\s+)?(?:TEMPORARY\s+|TEMP\s+)?TABLE\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s*\(([\s\S]*)\)\s*$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const names = qualified(match[1] ?? fallbackName);
  const body = match[2] ?? "";
  const columns: PgColumnShape[] = [];
  const constraints: PgConstraintShape[] = [];
  for (const fragment of splitTopLevel(body, ",")) {
    if (/^(CONSTRAINT\b|PRIMARY\s+KEY\b|UNIQUE\b|CHECK\b|FOREIGN\s+KEY\b)/i.test(fragment)) {
      const constraint = parseConstraint(fragment);
      if (constraint) {
        constraints.push(constraint);
      }
      continue;
    }
    const column = parseColumn(fragment);
    if (column) {
      columns.push(column);
    }
  }
  return {
    kind: "table",
    schema: names.schema ?? fallbackSchema,
    name: names.name || fallbackName,
    columns,
    constraints,
  };
}

function parseIndex(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
): PgObjectShape | null {
  const match =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+((?:"[^"]+"|[a-zA-Z_][\w$]*))\s+ON\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s*(?:USING\s+(\w+))?\s*\(([\s\S]*)\)\s*$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const table = qualified(match[3] ?? "");
  return {
    kind: "index",
    schema: table.schema ?? fallbackSchema,
    name: canonicalizeIdent(match[2] ?? fallbackName),
    tableSchema: table.schema ?? fallbackSchema,
    tableName: table.name,
    unique: Boolean(match[1]),
    method: (match[4] ?? "btree").toLowerCase(),
    columns: (match[5] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  };
}

function parseSequence(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
): PgObjectShape | null {
  const match =
    /CREATE\s+SEQUENCE\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)([\s\S]*)$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const names = qualified(match[1] ?? fallbackName);
  const rest = match[2] ?? "";
  const increment = /INCREMENT\s+BY\s+(-?\d+)/i.exec(rest)?.[1] ?? "1";
  const minValue = /MINVALUE\s+(-?\d+)/i.exec(rest)?.[1] ?? null;
  const maxValue = /MAXVALUE\s+(-?\d+)/i.exec(rest)?.[1] ?? null;
  const cache = /CACHE\s+(\d+)/i.exec(rest)?.[1] ?? "1";
  const cycle = /\bCYCLE\b/i.test(rest) && !/\bNO\s+CYCLE\b/i.test(rest);
  return {
    kind: "sequence",
    schema: names.schema ?? fallbackSchema,
    name: names.name || fallbackName,
    increment,
    minValue,
    maxValue,
    cycle,
    cache,
  };
}

function parseView(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
  materialized: boolean,
): PgObjectShape | null {
  const match =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMPORARY\s+)?(?:MATERIALIZED\s+)?VIEW\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)(?:\s*\([^)]*\))?\s+AS\s+([\s\S]+)$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const names = qualified(match[1] ?? fallbackName);
  return {
    kind: materialized ? "materialized_view" : "view",
    schema: names.schema ?? fallbackSchema,
    name: names.name || fallbackName,
    definition: match[2] ?? "",
  };
}

function parseConstraintObject(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
): PgObjectShape | null {
  const match =
    /ALTER\s+TABLE\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s+ADD\s+(CONSTRAINT\b[\s\S]+)$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const table = qualified(match[1] ?? "");
  const constraint = parseConstraint(match[2] ?? "");
  if (!constraint) {
    return null;
  }
  return {
    kind: "constraint",
    schema: table.schema ?? fallbackSchema,
    name: constraint.name || fallbackName,
    tableName: table.name,
    constraint: { ...constraint, name: constraint.name || fallbackName },
  };
}

function parseRoutine(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
  procedure: boolean,
): PgObjectShape | null {
  const match =
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)\s*\(([\s\S]*?)\)([\s\S]*)$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const names = qualified(match[1] ?? fallbackName);
  return {
    kind: procedure ? "procedure" : "function",
    schema: names.schema ?? fallbackSchema,
    name: names.name || fallbackName,
    identityArgs: match[2] ?? "",
    definition: sql,
  };
}

function parseTrigger(
  sql: string,
  fallbackSchema: string,
  fallbackName: string,
): PgObjectShape | null {
  const match =
    /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+((?:"[^"]+"|[a-zA-Z_][\w$]*))\s+[\s\S]*?\sON\s+((?:"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-zA-Z_][\w$]*))?)([\s\S]*)$/i.exec(
      sql,
    );
  if (!match) {
    return null;
  }
  const table = qualified(match[2] ?? "");
  return {
    kind: "trigger",
    schema: table.schema ?? fallbackSchema,
    name: canonicalizeIdent(match[1] ?? fallbackName),
    tableName: table.name,
    definition: sql,
  };
}

export function parseDesiredSql(input: {
  objectType: string;
  sql: string;
  schema: string;
  name: string;
}): PgObjectShape | null {
  const type = input.objectType.toUpperCase();
  const schema = canonicalizeIdent(input.schema);
  const name = canonicalizeIdent(input.name);
  const statements = splitStatements(input.sql).filter(
    (statement) => !/^CREATE\s+SCHEMA\b/i.test(statement),
  );
  const primary = pickPrimaryStatement(type, statements);
  switch (type) {
    case "TABLE": {
      const shape = parseTable(primary, schema, name);
      if (shape?.kind === "table") {
        applyTableFollowOns(shape, statements);
      }
      return shape;
    }
    case "INDEX":
      return parseIndex(primary, schema, name);
    case "SEQUENCE":
      return parseSequence(primary, schema, name);
    case "VIEW":
      return parseView(primary, schema, name, false);
    case "MATERIALIZED_VIEW":
      return parseView(primary, schema, name, true);
    case "CONSTRAINT":
      return parseConstraintObject(primary, schema, name) ?? parseTable(primary, schema, name);
    case "FUNCTION":
      return parseRoutine(primary, schema, name, false);
    case "PROCEDURE":
      return parseRoutine(primary, schema, name, true);
    case "TRIGGER":
      return parseTrigger(primary, schema, name);
    default:
      return null;
  }
}
