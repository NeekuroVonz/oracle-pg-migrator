import { describe, expect, test } from "bun:test";
import { classifyThreeWay, diffPgShapes, hashPgShape, type PgTableShape } from "./reconcile";

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

  test("drop column is destructive", () => {
    const actual = table([
      { name: "pk", type: "bigint", nullable: false, default: null },
      { name: "note", type: "text", nullable: true, default: null },
    ]);
    const desired = table([{ name: "pk", type: "bigint", nullable: false, default: null }]);
    const diff = diffPgShapes(desired, actual);
    expect(diff.destructive).toBe(true);
    expect(diff.changes.some((change) => change.kind === "drop_column")).toBe(true);
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

  test("manual target change is drift", () => {
    const result = classifyThreeWay({
      desiredHash: "desired",
      targetHash: "new-target",
      previousDesiredHash: "desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(result).toMatchObject({
      targetState: "TARGET_DRIFTED",
      reconcileAction: "REVIEW_REQUIRED",
    });
  });

  test("both sides changing is conflict", () => {
    const result = classifyThreeWay({
      desiredHash: "new-desired",
      targetHash: "new-target",
      previousDesiredHash: "old-desired",
      previousTargetHash: "old-target",
      kind: "table",
      destructive: false,
      populated: false,
    });
    expect(result).toMatchObject({
      targetState: "TARGET_CONFLICT",
      reconcileAction: "REVIEW_REQUIRED",
    });
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
