import {
  canonicalizeIdent,
  type PgObjectShape,
  type PgTableShape,
  type ReconcileAction,
  type ReconcileChange,
  type ReconcileDiff,
} from "@migrator/shared";
import { quotePgIdent } from "./bulk-load";

function q(ident: string): string {
  return quotePgIdent(ident);
}

function qualified(schema: string, name: string): string {
  return `${q(schema)}.${q(name)}`;
}

function columnSql(column: PgTableShape["columns"][number]): string {
  const nullSql = column.nullable ? "" : " NOT NULL";
  const defaultSql = column.default ? ` DEFAULT ${column.default}` : "";
  return `${q(column.name)} ${column.type}${nullSql}${defaultSql}`;
}

function constraintSql(constraint: PgTableShape["constraints"][number]): string {
  if (constraint.kind === "PRIMARY KEY") {
    return `CONSTRAINT ${q(constraint.name)} PRIMARY KEY (${constraint.columns.map(q).join(", ")})`;
  }
  if (constraint.kind === "UNIQUE") {
    return `CONSTRAINT ${q(constraint.name)} UNIQUE (${constraint.columns.map(q).join(", ")})`;
  }
  if (constraint.kind === "FOREIGN KEY" && constraint.referencedTable) {
    const ref = constraint.referencedSchema
      ? qualified(constraint.referencedSchema, constraint.referencedTable)
      : q(constraint.referencedTable);
    return `CONSTRAINT ${q(constraint.name)} FOREIGN KEY (${constraint.columns.map(q).join(", ")}) REFERENCES ${ref} (${constraint.referencedColumns.map(q).join(", ")})`;
  }
  return `CONSTRAINT ${q(constraint.name)} ${constraint.definition}`;
}

export function emitCreateFromShape(shape: PgObjectShape): string {
  switch (shape.kind) {
    case "table": {
      const cols = shape.columns.map(columnSql);
      const cons = shape.constraints.map(constraintSql);
      return `CREATE SCHEMA IF NOT EXISTS ${q(shape.schema)};\nCREATE TABLE ${qualified(shape.schema, shape.name)} (\n  ${[...cols, ...cons].join(",\n  ")}\n);`;
    }
    case "index": {
      const unique = shape.unique ? "UNIQUE " : "";
      return `CREATE ${unique}INDEX ${q(shape.name)} ON ${qualified(shape.tableSchema, shape.tableName)} USING ${shape.method} (${shape.columns.join(", ")});`;
    }
    case "sequence": {
      const min = shape.minValue ? ` MINVALUE ${shape.minValue}` : "";
      const max = shape.maxValue ? ` MAXVALUE ${shape.maxValue}` : "";
      const cycle = shape.cycle ? " CYCLE" : " NO CYCLE";
      return `CREATE SCHEMA IF NOT EXISTS ${q(shape.schema)};\nCREATE SEQUENCE ${qualified(shape.schema, shape.name)} INCREMENT BY ${shape.increment}${min}${max} CACHE ${shape.cache}${cycle};`;
    }
    case "view":
      return `CREATE SCHEMA IF NOT EXISTS ${q(shape.schema)};\nCREATE VIEW ${qualified(shape.schema, shape.name)} AS ${shape.definition};`;
    case "materialized_view":
      return `CREATE SCHEMA IF NOT EXISTS ${q(shape.schema)};\nCREATE MATERIALIZED VIEW ${qualified(shape.schema, shape.name)} AS ${shape.definition};`;
    case "function":
    case "procedure":
    case "trigger":
      return shape.definition.endsWith(";") ? shape.definition : `${shape.definition};`;
    case "constraint":
      return `ALTER TABLE ${qualified(shape.schema, shape.tableName)} ADD ${constraintSql(shape.constraint)};`;
  }
}

function tableAlter(desired: PgTableShape, changes: ReconcileChange[]): string[] {
  const statements: string[] = [];
  const table = qualified(desired.schema, desired.name);
  const columns = new Map(desired.columns.map((column) => [column.name, column]));
  for (const change of changes) {
    if (change.destructive) {
      continue;
    }
    if (change.kind === "add_column") {
      const name = change.path.replace(/^column\./, "");
      const column = columns.get(canonicalizeIdent(name));
      if (column) {
        statements.push(`ALTER TABLE ${table} ADD COLUMN ${columnSql(column)}`);
      }
    } else if (change.kind === "alter_column_type") {
      const name = change.path.replace(/^column\./, "").replace(/\.type$/, "");
      const column = columns.get(canonicalizeIdent(name));
      if (column) {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${q(column.name)} TYPE ${column.type} USING ${q(column.name)}::${column.type}`,
        );
      }
    } else if (change.kind === "alter_column_null") {
      const name = change.path.replace(/^column\./, "").replace(/\.nullable$/, "");
      const column = columns.get(canonicalizeIdent(name));
      if (column?.nullable) {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${q(column.name)} DROP NOT NULL`);
      }
    } else if (change.kind === "alter_column_default") {
      const name = change.path.replace(/^column\./, "").replace(/\.default$/, "");
      const column = columns.get(canonicalizeIdent(name));
      if (!column) {
        continue;
      }
      if (column.default == null) {
        statements.push(`ALTER TABLE ${table} ALTER COLUMN ${q(column.name)} DROP DEFAULT`);
      } else {
        statements.push(
          `ALTER TABLE ${table} ALTER COLUMN ${q(column.name)} SET DEFAULT ${column.default}`,
        );
      }
    } else if (change.kind === "add_constraint") {
      const name = change.path.replace(/^constraint\./, "");
      const constraint = desired.constraints.find(
        (item) => canonicalizeIdent(item.name) === canonicalizeIdent(name),
      );
      if (constraint) {
        statements.push(`ALTER TABLE ${table} ADD ${constraintSql(constraint)}`);
      }
    }
  }
  return statements;
}

export function emitReconcileSql(input: {
  action: ReconcileAction;
  desiredSql: string;
  desired: PgObjectShape;
  diff: ReconcileDiff;
}): string | null {
  if (input.action === "SKIP_UNCHANGED") {
    return null;
  }
  if (input.action === "REVIEW_REQUIRED") {
    return null;
  }
  if (input.action === "CREATE_REQUIRED") {
    return input.desiredSql;
  }
  if (input.action === "REPLACE_REQUIRED") {
    if (input.desired.kind === "view") {
      return `CREATE SCHEMA IF NOT EXISTS ${q(input.desired.schema)};\nCREATE OR REPLACE VIEW ${qualified(input.desired.schema, input.desired.name)} AS ${input.desired.definition};`;
    }
    return input.desiredSql.replace(
      /\bCREATE\s+(FUNCTION|PROCEDURE|TRIGGER)\b/i,
      "CREATE OR REPLACE $1",
    );
  }
  if (input.desired.kind === "table") {
    const statements = tableAlter(input.desired, input.diff.changes);
    if (statements.length === 0) {
      return null;
    }
    return `${statements.join(";\n")};`;
  }
  if (input.desired.kind === "sequence") {
    const parts: string[] = [];
    if (input.desired.increment) {
      parts.push(`INCREMENT BY ${input.desired.increment}`);
    }
    if (input.desired.minValue) {
      parts.push(`MINVALUE ${input.desired.minValue}`);
    }
    if (input.desired.maxValue) {
      parts.push(`MAXVALUE ${input.desired.maxValue}`);
    }
    parts.push(input.desired.cycle ? "CYCLE" : "NO CYCLE");
    parts.push(`CACHE ${input.desired.cache}`);
    return `ALTER SEQUENCE ${qualified(input.desired.schema, input.desired.name)} ${parts.join(" ")};`;
  }
  if (input.desired.kind === "index") {
    return `DROP INDEX IF EXISTS ${qualified(input.desired.schema, input.desired.name)};\n${emitCreateFromShape(input.desired)}`;
  }
  if (input.desired.kind === "constraint") {
    return `ALTER TABLE ${qualified(input.desired.schema, input.desired.tableName)} ADD ${constraintSql(input.desired.constraint)};`;
  }
  return input.desiredSql;
}
