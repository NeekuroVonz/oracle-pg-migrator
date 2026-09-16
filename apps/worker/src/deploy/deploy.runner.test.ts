import { describe, expect, test } from "bun:test";
import {
  applyObjectSql,
  isBenignConstraintPrimaryKeyDuplicate,
  shouldAcceptLiveObjectWithoutOverwrite,
  shouldRefuseAsTargetDrift,
} from "./deploy.runner";

describe("applyObjectSql", () => {
  test("applies statements in order and stops on the first error", async () => {
    const seen: string[] = [];
    await applyObjectSql(async (sql) => {
      seen.push(sql);
    }, "CREATE SCHEMA IF NOT EXISTS hr; CREATE TABLE hr.emp (id int);");
    expect(seen).toEqual(["CREATE SCHEMA IF NOT EXISTS hr", "CREATE TABLE hr.emp (id int)"]);

    const partial: string[] = [];
    await expect(
      applyObjectSql(async (sql) => {
        partial.push(sql);
        if (sql.includes("TABLE")) {
          throw new Error("relation already exists");
        }
      }, "CREATE SCHEMA IF NOT EXISTS hr; CREATE TABLE hr.emp (id int); CREATE INDEX emp_pk ON hr.emp (id);"),
    ).rejects.toThrow("relation already exists");
    expect(partial).toEqual(["CREATE SCHEMA IF NOT EXISTS hr", "CREATE TABLE hr.emp (id int)"]);
  });

  test("rejects empty SQL", async () => {
    await expect(applyObjectSql(async () => undefined, "   ")).rejects.toThrow("No SQL to deploy");
  });
});

describe("isBenignConstraintPrimaryKeyDuplicate", () => {
  test("accepts multiple primary keys on CONSTRAINT when inspect misses SYS_C names", () => {
    expect(
      isBenignConstraintPrimaryKeyDuplicate({
        objectType: "CONSTRAINT",
        message: 'multiple primary keys for table "tac_drpd" are not allowed',
        code: "42P16",
      }),
    ).toBe(true);
    expect(
      isBenignConstraintPrimaryKeyDuplicate({
        objectType: "INDEX",
        message: 'multiple primary keys for table "tac_drpd" are not allowed',
        code: "42P16",
      }),
    ).toBe(false);
  });
});

describe("shouldAcceptLiveObjectWithoutOverwrite", () => {
  test("accepts live object only when hashes match or desired hash is missing", () => {
    expect(
      shouldAcceptLiveObjectWithoutOverwrite({
        objectType: "SEQUENCE",
        reconcileAction: "SKIP_UNCHANGED",
        liveExists: true,
        liveHash: "aaa",
        desiredShapeHash: "aaa",
      }),
    ).toBe(true);
    expect(
      shouldAcceptLiveObjectWithoutOverwrite({
        objectType: "TABLE",
        reconcileAction: "SKIP_UNCHANGED",
        liveExists: true,
        liveHash: "bigint-shape",
        desiredShapeHash: "numeric-shape",
      }),
    ).toBe(false);
    expect(
      shouldAcceptLiveObjectWithoutOverwrite({
        objectType: "TABLE",
        reconcileAction: "UPDATE_REQUIRED",
        liveExists: true,
        liveHash: "aaa",
        desiredShapeHash: "bbb",
      }),
    ).toBe(false);
  });
});

describe("shouldRefuseAsTargetDrift", () => {
  test("does not refuse VIEW replace or planned UPDATE", () => {
    expect(
      shouldRefuseAsTargetDrift({
        objectType: "VIEW",
        reconcileAction: "UPDATE_REQUIRED",
        liveHash: "aaa",
        targetShapeHash: "bbb",
        desiredShapeHash: "ccc",
      }),
    ).toBe(false);
    expect(
      shouldRefuseAsTargetDrift({
        objectType: "VIEW",
        reconcileAction: "CREATE_REQUIRED",
        liveHash: "aaa",
        targetShapeHash: "bbb",
        desiredShapeHash: "ccc",
      }),
    ).toBe(false);
    expect(
      shouldRefuseAsTargetDrift({
        objectType: "TABLE",
        reconcileAction: "REVIEW_REQUIRED",
        liveHash: "aaa",
        targetShapeHash: "bbb",
        desiredShapeHash: "ccc",
      }),
    ).toBe(true);
    expect(
      shouldRefuseAsTargetDrift({
        objectType: "TABLE",
        reconcileAction: "UPDATE_REQUIRED",
        liveHash: "aaa",
        targetShapeHash: "bbb",
        desiredShapeHash: "ccc",
      }),
    ).toBe(false);
  });
});
