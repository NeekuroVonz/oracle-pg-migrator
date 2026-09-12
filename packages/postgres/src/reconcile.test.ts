import { describe, expect, test } from "bun:test";
import { canonicalizeShape, diffPgShapes, type PgTableShape } from "@migrator/shared";
import { parseDesiredSql } from "./parse-desired";
import { emitReconcileSql } from "./plan";
import { remapShapeLocation } from "./reconcile";

const tableSql = `CREATE SCHEMA IF NOT EXISTS wms1;
CREATE TABLE wms1.mail (
  pk bigint NOT NULL,
  body text,
  CONSTRAINT mail_pk PRIMARY KEY (pk)
);`;

describe("parseDesiredSql", () => {
  test("parses converter table DDL into a canonical table shape", () => {
    const shape = parseDesiredSql({
      objectType: "TABLE",
      sql: tableSql,
      schema: "wms1",
      name: "mail",
    });
    expect(shape?.kind).toBe("table");
    if (shape?.kind !== "table") {
      return;
    }
    const canonical = canonicalizeShape(shape) as PgTableShape;
    expect(canonical.columns.map((column) => column.name)).toEqual(["body", "pk"]);
    expect(canonical.constraints[0]?.kind).toBe("PRIMARY KEY");
  });

  test("parses an unschemaed unique index", () => {
    const shape = parseDesiredSql({
      objectType: "INDEX",
      sql: "CREATE UNIQUE INDEX mail_pk ON wms1.mail (pk);",
      schema: "wms1",
      name: "mail_pk",
    });
    expect(shape).toMatchObject({
      kind: "index",
      name: "mail_pk",
      unique: true,
      tableName: "mail",
    });
  });

  test("parses sequence NO CYCLE and CACHE", () => {
    const shape = parseDesiredSql({
      objectType: "SEQUENCE",
      sql: "CREATE SEQUENCE wms1.mail_seq INCREMENT BY 1 START WITH 1 CACHE 1 NO CYCLE;",
      schema: "wms1",
      name: "mail_seq",
    });
    expect(shape).toMatchObject({ kind: "sequence", cache: "1", cycle: false, increment: "1" });
  });
});

describe("emitReconcileSql", () => {
  test("emits ADD COLUMN for a safe table update", () => {
    const desired = parseDesiredSql({
      objectType: "TABLE",
      sql: `CREATE TABLE wms1.mail (pk bigint NOT NULL, note text);`,
      schema: "wms1",
      name: "mail",
    });
    const actual = parseDesiredSql({
      objectType: "TABLE",
      sql: `CREATE TABLE wms1.mail (pk bigint NOT NULL);`,
      schema: "wms1",
      name: "mail",
    });
    expect(desired && actual).toBeTruthy();
    if (!desired || !actual) {
      return;
    }
    const diff = diffPgShapes(desired, actual);
    const sql = emitReconcileSql({
      action: "UPDATE_REQUIRED",
      desiredSql: "CREATE TABLE wms1.mail (pk bigint NOT NULL, note text);",
      desired,
      diff,
    });
    expect(sql).toContain("ADD COLUMN");
    expect(sql).toContain("note");
    expect(sql?.toLowerCase()).not.toContain("drop");
  });

  test("does not emit SQL for review-required diffs", () => {
    const desired = parseDesiredSql({
      objectType: "TABLE",
      sql: `CREATE TABLE wms1.mail (pk bigint NOT NULL);`,
      schema: "wms1",
      name: "mail",
    });
    const actual = parseDesiredSql({
      objectType: "TABLE",
      sql: `CREATE TABLE wms1.mail (pk bigint NOT NULL, note text);`,
      schema: "wms1",
      name: "mail",
    });
    if (!desired || !actual) {
      return;
    }
    const sql = emitReconcileSql({
      action: "REVIEW_REQUIRED",
      desiredSql: "CREATE TABLE wms1.mail (pk bigint NOT NULL);",
      desired,
      diff: diffPgShapes(desired, actual),
    });
    expect(sql).toBeNull();
  });
});

describe("remapShapeLocation", () => {
  test("aligns a public table onto the converted schema for hash comparison", () => {
    const actual = parseDesiredSql({
      objectType: "TABLE",
      sql: "CREATE TABLE public.mail (pk bigint NOT NULL);",
      schema: "public",
      name: "mail",
    });
    expect(actual).toBeTruthy();
    if (!actual) {
      return;
    }
    const remapped = remapShapeLocation(actual, "wms1", "mail");
    expect(remapped.schema).toBe("wms1");
    expect(remapped.name).toBe("mail");
  });
});
