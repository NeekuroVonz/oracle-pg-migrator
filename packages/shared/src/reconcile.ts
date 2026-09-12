import type { ReconcileAction, TargetState } from "./enums";

export type PgShapeKind =
  | "table"
  | "index"
  | "sequence"
  | "view"
  | "materialized_view"
  | "function"
  | "procedure"
  | "trigger"
  | "constraint";

export interface PgColumnShape {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface PgConstraintShape {
  name: string;
  kind: "PRIMARY KEY" | "UNIQUE" | "CHECK" | "FOREIGN KEY";
  columns: string[];
  definition: string;
  referencedSchema: string | null;
  referencedTable: string | null;
  referencedColumns: string[];
}

export interface PgTableShape {
  kind: "table";
  schema: string;
  name: string;
  columns: PgColumnShape[];
  constraints: PgConstraintShape[];
}

export interface PgIndexShape {
  kind: "index";
  schema: string;
  name: string;
  tableSchema: string;
  tableName: string;
  unique: boolean;
  method: string;
  columns: string[];
}

export interface PgSequenceShape {
  kind: "sequence";
  schema: string;
  name: string;
  increment: string;
  minValue: string | null;
  maxValue: string | null;
  cycle: boolean;
  cache: string;
}

export interface PgViewShape {
  kind: "view" | "materialized_view";
  schema: string;
  name: string;
  definition: string;
}

export interface PgRoutineShape {
  kind: "function" | "procedure";
  schema: string;
  name: string;
  identityArgs: string;
  definition: string;
}

export interface PgTriggerShape {
  kind: "trigger";
  schema: string;
  name: string;
  tableName: string;
  definition: string;
}

export interface PgConstraintObjectShape {
  kind: "constraint";
  schema: string;
  name: string;
  tableName: string;
  constraint: PgConstraintShape;
}

export type PgObjectShape =
  | PgTableShape
  | PgIndexShape
  | PgSequenceShape
  | PgViewShape
  | PgRoutineShape
  | PgTriggerShape
  | PgConstraintObjectShape;

export type ReconcileChangeKind =
  | "create_object"
  | "drop_object"
  | "add_column"
  | "drop_column"
  | "alter_column_type"
  | "alter_column_null"
  | "alter_column_default"
  | "add_constraint"
  | "drop_constraint"
  | "alter_constraint"
  | "add_index"
  | "drop_index"
  | "alter_index"
  | "alter_sequence"
  | "replace_definition";

export interface ReconcileChange {
  kind: ReconcileChangeKind;
  path: string;
  from?: unknown;
  to?: unknown;
  destructive: boolean;
}

export interface ReconcileDiff {
  changes: ReconcileChange[];
  destructive: boolean;
}

export interface ThreeWayInput {
  desiredHash: string | null;
  targetHash: string | null;
  previousDesiredHash: string | null;
  previousTargetHash: string | null;
  kind: PgShapeKind | null;
  destructive: boolean;
  populated: boolean;
}

export interface ThreeWayResult {
  targetState: TargetState;
  reconcileAction: ReconcileAction;
  reason: string;
}

const REPLACEABLE_KINDS: ReadonlySet<PgShapeKind> = new Set([
  "view",
  "function",
  "procedure",
  "trigger",
]);

export function canonicalizeIdent(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed.toLowerCase();
}

export function canonicalizeType(raw: string): string {
  let type = raw.trim().toLowerCase().replace(/\s+/g, " ");
  type = type.replace(/^character varying\b/, "varchar");
  type = type.replace(/^character\b/, "char");
  type = type.replace(/^timestamp without time zone\b/, "timestamp");
  type = type.replace(/^timestamp with time zone\b/, "timestamptz");
  type = type.replace(/^time without time zone\b/, "time");
  type = type.replace(/^time with time zone\b/, "timetz");
  type = type.replace(/^boolean\b/, "boolean");
  type = type.replace(/^integer\b/, "integer");
  type = type.replace(/^bigint\b/, "bigint");
  type = type.replace(/^smallint\b/, "smallint");
  return type;
}

export function canonicalizeDefault(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  let value = raw.trim().replace(/\s+/g, " ");
  value = value.replace(/::[\w. "]+/g, "");
  value = value.replace(/nextval\('(?:[^']+\.)?([^']+)'\)/i, (_match, name: string) => {
    return `nextval('${canonicalizeIdent(name)}')`;
  });
  return value.toLowerCase();
}

export function canonicalizeDefinition(raw: string): string {
  return raw
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, nested]) => [key, sortKeys(nested)]));
  }
  return value;
}

export function canonicalizeShape(shape: PgObjectShape): PgObjectShape {
  switch (shape.kind) {
    case "table":
      return {
        kind: "table",
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        columns: [...shape.columns]
          .map((column) => ({
            name: canonicalizeIdent(column.name),
            type: canonicalizeType(column.type),
            nullable: column.nullable,
            default: canonicalizeDefault(column.default),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        constraints: [...shape.constraints]
          .map((constraint) => ({
            name: canonicalizeIdent(constraint.name),
            kind: constraint.kind,
            columns: [...constraint.columns].map(canonicalizeIdent).sort(),
            definition: canonicalizeDefinition(constraint.definition),
            referencedSchema: constraint.referencedSchema
              ? canonicalizeIdent(constraint.referencedSchema)
              : null,
            referencedTable: constraint.referencedTable
              ? canonicalizeIdent(constraint.referencedTable)
              : null,
            referencedColumns: [...constraint.referencedColumns].map(canonicalizeIdent).sort(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    case "index":
      return {
        kind: "index",
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        tableSchema: canonicalizeIdent(shape.tableSchema),
        tableName: canonicalizeIdent(shape.tableName),
        unique: shape.unique,
        method: shape.method.toLowerCase(),
        columns: shape.columns.map((column) => canonicalizeDefinition(column)),
      };
    case "sequence":
      return {
        kind: "sequence",
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        increment: String(shape.increment),
        minValue: shape.minValue,
        maxValue: shape.maxValue,
        cycle: shape.cycle,
        cache: String(shape.cache),
      };
    case "view":
    case "materialized_view":
      return {
        kind: shape.kind,
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        definition: canonicalizeDefinition(shape.definition),
      };
    case "function":
    case "procedure":
      return {
        kind: shape.kind,
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        identityArgs: canonicalizeDefinition(shape.identityArgs),
        definition: canonicalizeDefinition(shape.definition),
      };
    case "trigger":
      return {
        kind: "trigger",
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        tableName: canonicalizeIdent(shape.tableName),
        definition: canonicalizeDefinition(shape.definition),
      };
    case "constraint":
      return {
        kind: "constraint",
        schema: canonicalizeIdent(shape.schema),
        name: canonicalizeIdent(shape.name),
        tableName: canonicalizeIdent(shape.tableName),
        constraint: {
          name: canonicalizeIdent(shape.constraint.name),
          kind: shape.constraint.kind,
          columns: [...shape.constraint.columns].map(canonicalizeIdent).sort(),
          definition: canonicalizeDefinition(shape.constraint.definition),
          referencedSchema: shape.constraint.referencedSchema
            ? canonicalizeIdent(shape.constraint.referencedSchema)
            : null,
          referencedTable: shape.constraint.referencedTable
            ? canonicalizeIdent(shape.constraint.referencedTable)
            : null,
          referencedColumns: [...shape.constraint.referencedColumns].map(canonicalizeIdent).sort(),
        },
      };
  }
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashPgShape(shape: PgObjectShape | null): string | null {
  if (!shape) {
    return null;
  }
  const canonical = canonicalizeShape(shape);
  return hashText(JSON.stringify(sortKeys(canonical)));
}

interface ParsedType {
  name: string;
  length: number | null;
  precision: number | null;
  scale: number | null;
}

function parseType(raw: string): ParsedType {
  const type = canonicalizeType(raw);
  const match =
    /^(varchar|char|numeric|timestamp|timestamptz)\s*\(\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/.exec(type);
  if (match) {
    const name = match[1] ?? type;
    const first = match[2] ? Number(match[2]) : null;
    const second = match[3] ? Number(match[3]) : null;
    if (name === "numeric") {
      return { name, length: null, precision: first, scale: second ?? 0 };
    }
    return { name, length: first, precision: null, scale: null };
  }
  return { name: type.replace(/\s*\(.*\)$/, ""), length: null, precision: null, scale: null };
}

const WIDEN: Record<string, string[]> = {
  smallint: ["integer", "bigint", "numeric"],
  integer: ["bigint", "numeric"],
  bigint: ["numeric"],
  real: ["double precision", "numeric"],
  "double precision": ["numeric"],
  varchar: ["text"],
  char: ["varchar", "text"],
};

function typeChangeDestructive(from: string, to: string): boolean {
  if (from === to) {
    return false;
  }
  const source = parseType(from);
  const dest = parseType(to);
  if (source.name === dest.name) {
    if (source.length != null && dest.length != null && dest.length < source.length) {
      return true;
    }
    if (source.precision != null && dest.precision != null && dest.precision < source.precision) {
      return true;
    }
    if (source.scale != null && dest.scale != null && dest.scale < source.scale) {
      return true;
    }
    return false;
  }
  const allowed = WIDEN[source.name] ?? [];
  if (allowed.includes(dest.name)) {
    return false;
  }
  return true;
}

function change(
  kind: ReconcileChangeKind,
  path: string,
  destructive: boolean,
  from?: unknown,
  to?: unknown,
): ReconcileChange {
  return { kind, path, destructive, from, to };
}

function diffTables(desired: PgTableShape, actual: PgTableShape): ReconcileChange[] {
  const changes: ReconcileChange[] = [];
  const desiredCols = new Map(desired.columns.map((column) => [column.name, column]));
  const actualCols = new Map(actual.columns.map((column) => [column.name, column]));
  for (const column of desired.columns) {
    const existing = actualCols.get(column.name);
    if (!existing) {
      changes.push(
        change(
          "add_column",
          `column.${column.name}`,
          !column.nullable && column.default == null,
          undefined,
          column,
        ),
      );
      continue;
    }
    if (existing.type !== column.type) {
      changes.push(
        change(
          "alter_column_type",
          `column.${column.name}.type`,
          typeChangeDestructive(existing.type, column.type),
          existing.type,
          column.type,
        ),
      );
    }
    if (existing.nullable !== column.nullable) {
      changes.push(
        change(
          "alter_column_null",
          `column.${column.name}.nullable`,
          existing.nullable && !column.nullable,
          existing.nullable,
          column.nullable,
        ),
      );
    }
    if (existing.default !== column.default) {
      changes.push(
        change(
          "alter_column_default",
          `column.${column.name}.default`,
          false,
          existing.default,
          column.default,
        ),
      );
    }
  }
  for (const column of actual.columns) {
    if (!desiredCols.has(column.name)) {
      changes.push(change("drop_column", `column.${column.name}`, true, column, undefined));
    }
  }
  const desiredCons = new Map(desired.constraints.map((item) => [item.name, item]));
  const actualCons = new Map(actual.constraints.map((item) => [item.name, item]));
  for (const constraint of desired.constraints) {
    const existing = actualCons.get(constraint.name);
    if (!existing) {
      const risky = constraint.kind !== "CHECK";
      changes.push(
        change("add_constraint", `constraint.${constraint.name}`, risky, undefined, constraint),
      );
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(constraint)) {
      changes.push(
        change("alter_constraint", `constraint.${constraint.name}`, true, existing, constraint),
      );
    }
  }
  for (const constraint of actual.constraints) {
    if (!desiredCons.has(constraint.name)) {
      changes.push(
        change("drop_constraint", `constraint.${constraint.name}`, true, constraint, undefined),
      );
    }
  }
  return changes;
}

export function diffPgShapes(desired: PgObjectShape, actual: PgObjectShape | null): ReconcileDiff {
  if (!actual) {
    return {
      changes: [change("create_object", desired.name, false, undefined, desired.kind)],
      destructive: false,
    };
  }
  if (desired.kind !== actual.kind) {
    return {
      changes: [change("drop_object", actual.name, true, actual.kind, desired.kind)],
      destructive: true,
    };
  }
  let changes: ReconcileChange[] = [];
  switch (desired.kind) {
    case "table":
      changes = diffTables(desired, actual as PgTableShape);
      break;
    case "index": {
      const other = actual as PgIndexShape;
      if (
        desired.unique !== other.unique ||
        desired.method !== other.method ||
        desired.tableName !== other.tableName ||
        JSON.stringify(desired.columns) !== JSON.stringify(other.columns)
      ) {
        changes.push(change("alter_index", desired.name, false, other, desired));
      }
      break;
    }
    case "sequence": {
      const other = actual as PgSequenceShape;
      if (
        desired.increment !== other.increment ||
        desired.minValue !== other.minValue ||
        desired.maxValue !== other.maxValue ||
        desired.cycle !== other.cycle ||
        desired.cache !== other.cache
      ) {
        changes.push(change("alter_sequence", desired.name, false, other, desired));
      }
      break;
    }
    case "view":
    case "materialized_view": {
      const other = actual as PgViewShape;
      if (desired.definition !== other.definition) {
        changes.push(
          change(
            "replace_definition",
            desired.name,
            desired.kind === "materialized_view",
            other.definition,
            desired.definition,
          ),
        );
      }
      break;
    }
    case "function":
    case "procedure": {
      const other = actual as PgRoutineShape;
      if (desired.definition !== other.definition || desired.identityArgs !== other.identityArgs) {
        changes.push(change("replace_definition", desired.name, false, other, desired));
      }
      break;
    }
    case "trigger": {
      const other = actual as PgTriggerShape;
      if (desired.definition !== other.definition || desired.tableName !== other.tableName) {
        changes.push(change("replace_definition", desired.name, false, other, desired));
      }
      break;
    }
    case "constraint": {
      const other = actual as PgConstraintObjectShape;
      if (JSON.stringify(desired.constraint) !== JSON.stringify(other.constraint)) {
        changes.push(
          change("alter_constraint", desired.name, true, other.constraint, desired.constraint),
        );
      }
      break;
    }
  }
  return { changes, destructive: changes.some((item) => item.destructive) };
}

export function classifyThreeWay(input: ThreeWayInput): ThreeWayResult {
  if (!input.desiredHash) {
    return {
      targetState: input.targetHash ? "TARGET_DIFFERENT" : "TARGET_MISSING",
      reconcileAction: "REVIEW_REQUIRED",
      reason: "No desired PostgreSQL definition to compare",
    };
  }
  if (!input.targetHash) {
    return {
      targetState: "TARGET_MISSING",
      reconcileAction: "CREATE_REQUIRED",
      reason: "Object does not exist on the PostgreSQL target",
    };
  }
  if (input.targetHash === input.desiredHash) {
    return {
      targetState: "TARGET_MATCHED",
      reconcileAction: "SKIP_UNCHANGED",
      reason: "Target already matches the desired PostgreSQL definition",
    };
  }
  const desiredChanged =
    Boolean(input.previousDesiredHash) && input.previousDesiredHash !== input.desiredHash;
  const targetChanged =
    Boolean(input.previousTargetHash) && input.previousTargetHash !== input.targetHash;
  if (input.previousDesiredHash && input.previousTargetHash) {
    if (targetChanged && !desiredChanged) {
      return {
        targetState: "TARGET_DRIFTED",
        reconcileAction: "REVIEW_REQUIRED",
        reason: "PostgreSQL target changed manually after the previous migration",
      };
    }
    if (targetChanged && desiredChanged) {
      return {
        targetState: "TARGET_CONFLICT",
        reconcileAction: "REVIEW_REQUIRED",
        reason: "Both the desired definition and the PostgreSQL target changed",
      };
    }
  }
  if (input.destructive) {
    return {
      targetState: "TARGET_DIFFERENT",
      reconcileAction: "REVIEW_REQUIRED",
      reason: input.populated
        ? "Structural change may affect existing data"
        : "Difference is destructive, ambiguous, or may affect existing data",
    };
  }
  if (input.kind && REPLACEABLE_KINDS.has(input.kind)) {
    return {
      targetState: "TARGET_DIFFERENT",
      reconcileAction: "REPLACE_REQUIRED",
      reason: "Definition differs; CREATE OR REPLACE is the minimum change",
    };
  }
  return {
    targetState: "TARGET_DIFFERENT",
    reconcileAction: "UPDATE_REQUIRED",
    reason: "Target exists and a non-destructive ALTER can be applied",
  };
}

export function populatedBlocksAutoUpdate(diff: ReconcileDiff): boolean {
  return diff.changes.some((changeItem) => {
    if (changeItem.kind === "add_column") {
      return changeItem.destructive;
    }
    if (changeItem.kind === "alter_column_type" || changeItem.kind === "alter_column_null") {
      return changeItem.destructive;
    }
    return (
      changeItem.kind === "add_constraint" ||
      changeItem.kind === "alter_constraint" ||
      changeItem.kind === "drop_column" ||
      changeItem.kind === "drop_constraint"
    );
  });
}
