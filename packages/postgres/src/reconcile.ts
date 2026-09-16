import {
  canonicalizeIdent,
  classifyThreeWay,
  diffPgShapes,
  hashPgShape,
  type PgObjectShape,
  populatedBlocksAutoUpdate,
  type ReconcileAction,
  type ReconcileDiff,
  type TargetState,
  type ThreeWayResult,
} from "@migrator/shared";
import { countTargetRows, inspectTargetObject, type PgCatalogExecutor } from "./inspect";
import { parseDesiredSql } from "./parse-desired";
import { emitCreateFromShape, emitReconcileSql } from "./plan";

export interface ReconcileObjectInput {
  executor: PgCatalogExecutor;
  objectType: string;
  schema: string;
  name: string;
  desiredSql: string | null;
  previousDesiredHash: string | null;
  previousTargetHash: string | null;
  estimatedRowCount?: number | null;
}

export interface ReconcileObjectResult extends ThreeWayResult {
  desired: PgObjectShape | null;
  actual: PgObjectShape | null;
  desiredHash: string | null;
  targetHash: string | null;
  diff: ReconcileDiff;
  reconcileSql: string | null;
  cloneSql: string | null;
}

export function remapShapeLocation(
  shape: PgObjectShape,
  schema: string,
  name: string,
): PgObjectShape {
  const next = { ...shape, schema, name };
  if ("tableSchema" in next) {
    return { ...next, tableSchema: schema };
  }
  return next;
}

export async function reconcileObject(input: ReconcileObjectInput): Promise<ReconcileObjectResult> {
  const schema = canonicalizeIdent(input.schema);
  const name = canonicalizeIdent(input.name);
  const desired = input.desiredSql
    ? parseDesiredSql({
        objectType: input.objectType,
        sql: input.desiredSql,
        schema,
        name,
      })
    : null;
  const actual = await inspectTargetObject(input.executor, {
    objectType: input.objectType,
    schema,
    name,
  });
  const actualForCompare =
    actual && desired && (actual.schema !== desired.schema || actual.name !== desired.name)
      ? remapShapeLocation(actual, desired.schema, desired.name)
      : actual;
  const desiredHash = hashPgShape(desired);
  const targetHash = hashPgShape(actualForCompare);
  const diff = desired
    ? diffPgShapes(desired, actualForCompare)
    : { changes: [], destructive: false };
  let populated = (input.estimatedRowCount ?? 0) > 0;
  if (!populated && actual?.kind === "table") {
    const live = await countTargetRows(input.executor, actual.schema, actual.name);
    populated = (live ?? 0) > 0;
  }
  const destructive =
    diff.destructive ||
    (populated && populatedBlocksAutoUpdate(diff)) ||
    (desired?.kind === "materialized_view" && diff.changes.length > 0);
  let classified = classifyThreeWay({
    desiredHash,
    targetHash,
    previousDesiredHash: input.previousDesiredHash,
    previousTargetHash: input.previousTargetHash,
    kind: desired?.kind ?? actual?.kind ?? null,
    destructive,
    populated,
  });
  // Cosmetic hash drift (e.g. system PK name) with an empty structural diff is a match.
  if (
    classified.reconcileAction === "UPDATE_REQUIRED" &&
    diff.changes.length === 0 &&
    desiredHash &&
    targetHash
  ) {
    classified = {
      targetState: "TARGET_MATCHED",
      reconcileAction: "SKIP_UNCHANGED",
      reason: "Target already matches the desired PostgreSQL definition",
    };
  }
  const desiredForPlan =
    desired && actual ? remapShapeLocation(desired, actual.schema, actual.name) : desired;
  const reconcileSql =
    desiredForPlan && input.desiredSql
      ? emitReconcileSql({
          action: classified.reconcileAction,
          desiredSql: input.desiredSql,
          desired: desiredForPlan,
          diff,
        })
      : classified.reconcileAction === "CREATE_REQUIRED"
        ? input.desiredSql
        : null;
  const cloneSql =
    actual &&
    (classified.reconcileAction === "UPDATE_REQUIRED" ||
      classified.reconcileAction === "REPLACE_REQUIRED")
      ? emitCreateFromShape(actual)
      : null;
  return {
    ...classified,
    desired,
    actual,
    desiredHash,
    targetHash,
    diff,
    reconcileSql,
    cloneSql,
  };
}

export function sandboxSqlForAction(input: {
  action: ReconcileAction;
  desiredSql: string | null;
  reconcileSql: string | null;
  cloneSql: string | null;
}): string | null {
  // Scratch validator is empty. TARGET match/drift is a deploy concern — still CREATE.
  if (input.action === "SKIP_UNCHANGED" || input.action === "REVIEW_REQUIRED") {
    return input.desiredSql;
  }
  if (input.action === "CREATE_REQUIRED") {
    return input.desiredSql;
  }
  if (!input.cloneSql || !input.reconcileSql) {
    return input.reconcileSql ?? input.desiredSql;
  }
  return `${input.cloneSql}\n${input.reconcileSql}`;
}

export type { TargetState };
