import { describe, expect, test } from "bun:test";
import { classifyThreeWay, diffPgShapes, hashPgShape, populatedBlocksAutoUpdate, type PgTableShape } from "./reconcile";

function table(
  columns: PgTableShape["columns"],
  constraints: PgTableShape["constraints"] = [],
): PgTableShape {
  return {
    kind: "table",
    schema: "wms1",
    name: "mail",
    columns,
    constraints,
  };
}

const pk = {
  name: "mail_pk",
  kind: "PRIMARY KEY" as const,
  columns: ["pk"],
  definition: "primary key (pk)",
  referencedSchema: null,
  referencedTable: null,
  referencedColumns: [],
};

describe("hashPgShape", () => {
  test("is stable across column order and ident case", () => {
    const a = table(
      [
        { name: "BODY", type: "text", nullable: true, default: null },
        { name: "PK", type: "bigint", nullable: false, default: null },
      ],
      [pk],
    );
    const b = table(
      [
        { name: "pk", type: "bigint", nullable: false, default: null },
        { name: "body", type: "text", nullable: true, default: null },
      ],
      [pk],
    );
    expect(hashPgShape(a)).toBe(hashPgShape(b));
  });
});

describe("diffPgShapes", () => {
  test("add nullable column is not destructive", () => {
    const actual = table([{ name: "pk", type: "bigint", nullable: false, default: null }]);
    const desired = table([
      { name: "pk", type: "bigint", nullable: false, default: null },
      { name: "note", type: "text", nullable: true, default: null },
    ]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.destructive).toBe(false);
    expect(diff.changes.map((change) => change.kind)).toEqual(["add_column"]);
  });

  test("drop column is ignored for auto-reconcile (keep extra TARGET columns)", () => {
    const actual = table([
      { name: "pk", type: "bigint", nullable: false, default: null },
      { name: "note", type: "text", nullable: true, default: null },
    ]);
    const desired = table([{ name: "pk", type: "bigint", nullable: false, default: null }]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.destructive).toBe(false);
    expect(diff.changes.some((change) => change.kind === "drop_column")).toBe(false);
  });

  test("shrinking varchar is destructive and widening is not", () => {
    const actual = table([{ name: "code", type: "varchar(20)", nullable: true, default: null }]);
    const shrink = diffPgShapes(
      table([{ name: "code", type: "varchar(10)", nullable: true, default: null }]),
      actual,
    );
    const widen = diffPgShapes(
      table([{ name: "code", type: "varchar(40)", nullable: true, default: null }]),
      actual,
    );
    expect(shrink.destructive).toBe(true);
    expect(widen.destructive).toBe(false);
  });

  test("widening a populated column does not block auto-update", () => {
    const actual = table([{ name: "code", type: "varchar(20)", nullable: true, default: null }]);
    const desired = table([{ name: "code", type: "varchar(40)", nullable: true, default: null }]);
    expect(populatedBlocksAutoUpdate(diffPgShapes(desired, actual))).toBe(false);
  });

  test("extra TARGET columns do not block auto-update", () => {
    const actual = table([
      { name: "pk", type: "bigint", nullable: false, default: null },
      { name: "note", type: "text", nullable: true, default: null },
    ]);
    const desired = table([{ name: "pk", type: "bigint", nullable: false, default: null }]);
    expect(populatedBlocksAutoUpdate(diffPgShapes(desired, actual))).toBe(false);
  });

  test("keeping wider numeric instead of shrinking to smallint", () => {
    const actual = table([{ name: "ord", type: "numeric", nullable: true, default: null }]);
    const desired = table([{ name: "ord", type: "smallint", nullable: true, default: null }]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.changes).toEqual([]);
    expect(diff.destructive).toBe(false);
  });
  test("bigint to numeric is a safe widen", () => {
    const actual = table([{ name: "amount", type: "bigint", nullable: true, default: null }]);
    const desired = table([{ name: "amount", type: "numeric", nullable: true, default: null }]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.destructive).toBe(false);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.kind).toBe("alter_column_type");
  });

  test("varchar and character varying are the same type", () => {
    const actual = table([
      { name: "code", type: "character varying(20)", nullable: true, default: null },
    ]);
    const desired = table([{ name: "code", type: "varchar(20)", nullable: true, default: null }]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.changes).toEqual([]);
    expect(diff.destructive).toBe(false);
  });

  test("PRIMARY KEY with same columns but different names is not a change", () => {
    const actual = table([{ name: "pk", type: "bigint", nullable: false, default: null }], [
      {
        name: "mail_pkey",
        kind: "PRIMARY KEY",
        columns: ["pk"],
        definition: "PRIMARY KEY (pk)",
        referencedSchema: null,
        referencedTable: null,
        referencedColumns: [],
      },
    ]);
    const desired = table([{ name: "pk", type: "bigint", nullable: false, default: null }], [
      {
        name: "constraint",
        kind: "PRIMARY KEY",
        columns: ["pk"],
        definition: "PRIMARY KEY (pk)",
        referencedSchema: null,
        referencedTable: null,
        referencedColumns: [],
      },
    ]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.changes.some((item) => item.kind.includes("constraint"))).toBe(false);
  });
});

describe("classifyThreeWay", () => {
  test("missing target requires create", () => {
    const result = classifyThreeWay({
      desiredHash: "aaa",
      targetHash: null,
      previousDesiredHash: null,
      previousTargetHash: null,
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(result).toMatchObject({
      targetState: "TARGET_MISSING",
      reconcileAction: "CREATE_REQUIRED",
    });
  });

  test("matching hashes skip unchanged", () => {
    const result = classifyThreeWay({
      desiredHash: "aaa",
      targetHash: "aaa",
      previousDesiredHash: "aaa",
      previousTargetHash: "aaa",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(result).toMatchObject({
      targetState: "TARGET_MATCHED",
      reconcileAction: "SKIP_UNCHANGED",
    });
  });

  test("manual target change is drift only when destructive", () => {
    const drifted = classifyThreeWay({
      desiredHash: "desired",
      targetHash: "new-target",
      previousDesiredHash: "desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: true,
      populated: false,
    });
    expect(drifted).toMatchObject({
      targetState: "TARGET_DRIFTED",
      reconcileAction: "REVIEW_REQUIRED",
    });
    const safe = classifyThreeWay({
      desiredHash: "desired",
      targetHash: "new-target",
      previousDesiredHash: "desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(safe.reconcileAction).toBe("UPDATE_REQUIRED");
  });

  test("both sides changing is conflict only when destructive", () => {
    const conflict = classifyThreeWay({
      desiredHash: "new-desired",
      targetHash: "new-target",
      previousDesiredHash: "old-desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: true,
      populated: false,
    });
    expect(conflict).toMatchObject({
      targetState: "TARGET_CONFLICT",
      reconcileAction: "REVIEW_REQUIRED",
    });
    const safe = classifyThreeWay({
      desiredHash: "new-desired",
      targetHash: "new-target",
      previousDesiredHash: "old-desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(safe.reconcileAction).toBe("UPDATE_REQUIRED");
  });

  test("safe table diff is update required", () => {
    const result = classifyThreeWay({
      desiredHash: "new-desired",
      targetHash: "old-target",
      previousDesiredHash: "old-desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(result).toMatchObject({
      targetState: "TARGET_DIFFERENT",
      reconcileAction: "UPDATE_REQUIRED",
    });
  });

  test("view definition replace uses REPLACE_REQUIRED", () => {
    const result = classifyThreeWay({
      desiredHash: "new",
      targetHash: "old",
      previousDesiredHash: "old",
      previousTargetHash: "old",
      kind: "view",
      destructive: false,
      populated: false,
    });
    expect(result.reconcileAction).toBe("REPLACE_REQUIRED");
  });
});
