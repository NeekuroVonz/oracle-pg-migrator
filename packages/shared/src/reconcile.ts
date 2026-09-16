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
          .map((constraint) => {
            const columns = [...constraint.columns].map(canonicalizeIdent).sort();
            const stableName =
              constraint.kind === "PRIMARY KEY" || constraint.kind === "UNIQUE"
                ? `${constraint.kind.toLowerCase().replace(/\s+/g, "_")}:${columns.join(",")}`
                : canonicalizeIdent(constraint.name);
            const stableDefinition =
              constraint.kind === "PRIMARY KEY"
                ? `primary key (${columns.join(", ")})`
                : constraint.kind === "UNIQUE"
                  ? `unique (${columns.join(", ")})`
                  : canonicalizeDefinition(constraint.definition);
            return {
              name: stableName,
              kind: constraint.kind,
              columns,
              definition: stableDefinition,
              referencedSchema: constraint.referencedSchema
                ? canonicalizeIdent(constraint.referencedSchema)
                : null,
              referencedTable: constraint.referencedTable
                ? canonicalizeIdent(constraint.referencedTable)
                : null,
              referencedColumns: [...constraint.referencedColumns].map(canonicalizeIdent).sort(),
            };
          })
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

function isWiderNumericKept(from: string, to: string): boolean {
  const source = parseType(canonicalizeType(from));
  const dest = parseType(canonicalizeType(to));
  // TARGET already widened (e.g. data-copy); do not shrink back to smallint/integer.
  if (source.name === "numeric" && ["smallint", "integer", "bigint"].includes(dest.name)) {
    return true;
  }
  if (source.name === "bigint" && ["smallint", "integer"].includes(dest.name)) {
    return true;
  }
  if (source.name === "integer" && dest.name === "smallint") {
    return true;
  }
  return false;
}

function typeChangeDestructive(from: string, to: string): boolean {
  if (from === to || isWiderNumericKept(from, to)) {
    return false;
  }
  const source = parseType(canonicalizeType(from));
  const dest = parseType(canonicalizeType(to));
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

function constraintMatchKey(constraint: PgConstraintShape): string {
  if (constraint.kind === "PRIMARY KEY" || constraint.kind === "UNIQUE") {
    return `${constraint.kind}:${[...constraint.columns].map(canonicalizeIdent).sort().join(",")}`;
  }
  return `name:${canonicalizeIdent(constraint.name)}`;
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
    const existingType = canonicalizeType(existing.type);
    const desiredType = canonicalizeType(column.type);
    if (existingType !== desiredType && !isWiderNumericKept(existingType, desiredType)) {
      changes.push(
        change(
          "alter_column_type",
          `column.${column.name}.type`,
          typeChangeDestructive(existingType, desiredType),
          existingType,
          desiredType,
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
    const existingDefault = canonicalizeDefault(existing.default);
    const desiredDefault = canonicalizeDefault(column.default);
    if (existingDefault !== desiredDefault) {
      changes.push(
        change(
          "alter_column_default",
          `column.${column.name}.default`,
          false,
          existingDefault,
          desiredDefault,
        ),
      );
    }
  }
  for (const column of actual.columns) {
    if (!desiredCols.has(column.name)) {
      // Keep extra TARGET columns (GTT leftovers / prior mapping bugs); never auto-DROP.
      continue;
    }
  }
  const desiredCons = new Map(desired.constraints.map((item) => [constraintMatchKey(item), item]));
  const actualCons = new Map(actual.constraints.map((item) => [constraintMatchKey(item), item]));
  for (const [key, constraint] of desiredCons) {
    const existing = actualCons.get(key);
    if (!existing) {
      const risky = constraint.kind !== "CHECK";
      changes.push(
        change("add_constraint", `constraint.${constraint.name}`, risky, undefined, constraint),
      );
      continue;
    }
    // Same PK/UNIQUE columns under a different system name is not a structural change.
    if (
      constraint.kind !== "PRIMARY KEY" &&
      constraint.kind !== "UNIQUE" &&
      JSON.stringify(existing) !== JSON.stringify(constraint)
    ) {
      changes.push(
        change("alter_constraint", `constraint.${constraint.name}`, true, existing, constraint),
      );
    }
  }
  for (const [key, constraint] of actualCons) {
    if (!desiredCons.has(key)) {
      // Table DDL often omits PKs that live as separate CONSTRAINT objects — never drop.
      continue;
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
  const left = canonicalizeShape(desired);
  const right = canonicalizeShape(actual);
  if (left.kind !== right.kind) {
    return {
      changes: [change("drop_object", right.name, true, right.kind, left.kind)],
      destructive: true,
    };
  }
  let changes: ReconcileChange[] = [];
  switch (left.kind) {
    case "table":
      changes = diffTables(left, right as PgTableShape);
      break;
    case "index": {
      const other = right as PgIndexShape;
      if (
        left.unique !== other.unique ||
        left.method !== other.method ||
        left.tableName !== other.tableName ||
        JSON.stringify(left.columns) !== JSON.stringify(other.columns)
      ) {
        changes.push(change("alter_index", left.name, false, other, left));
      }
      break;
    }
    case "sequence": {
      const other = right as PgSequenceShape;
      if (
        left.increment !== other.increment ||
        left.minValue !== other.minValue ||
        left.maxValue !== other.maxValue ||
        left.cycle !== other.cycle ||
        left.cache !== other.cache
      ) {
        changes.push(change("alter_sequence", left.name, false, other, left));
      }
      break;
    }
    case "view":
    case "materialized_view": {
      const other = right as PgViewShape;
      if (left.definition !== other.definition) {
        changes.push(
          change(
            "replace_definition",
            left.name,
            left.kind === "materialized_view",
            other.definition,
            left.definition,
          ),
        );
      }
      break;
    }
    case "function":
    case "procedure": {
      const other = right as PgRoutineShape;
      if (left.definition !== other.definition || left.identityArgs !== other.identityArgs) {
        changes.push(change("replace_definition", left.name, false, other, left));
      }
      break;
    }
    case "trigger": {
      const other = right as PgTriggerShape;
      if (left.definition !== other.definition || left.tableName !== other.tableName) {
        changes.push(change("replace_definition", left.name, false, other, left));
      }
      break;
    }
    case "constraint": {
      const other = right as PgConstraintObjectShape;
      if (JSON.stringify(left.constraint) !== JSON.stringify(other.constraint)) {
        changes.push(
          change("alter_constraint", left.name, true, other.constraint, left.constraint),
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
    // Only refuse when the live drift is destructive. Safe widens (bigint→numeric) and
    // our own prior ALTERs must not block UPDATE after a mapping-rules change.
    if (targetChanged && !desiredChanged && input.destructive) {
      return {
        targetState: "TARGET_DRIFTED",
        reconcileAction: "REVIEW_REQUIRED",
        reason: "PostgreSQL target changed manually after the previous migration",
      };
    }
    if (targetChanged && desiredChanged && input.destructive) {
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
