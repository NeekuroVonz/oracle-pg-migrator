import { describe, expect, test } from "bun:test";
import {
  formatParentIssue,
  parentTableRef,
  selectDeployableWithParents,
  type DeployCandidate,
} from "./select-deployable";

function row(partial: Partial<DeployCandidate> & Pick<DeployCandidate, "id" | "name" | "objectType">): DeployCandidate {
  return {
    owner: "WMS1",
    status: "VALIDATED",
    deferred: false,
    reconcileAction: "CREATE_REQUIRED",
    targetState: null,
    targetSql: `CREATE ${partial.objectType} ${partial.name}`,
    reconcileSql: null,
    targetSchema: "wms1",
    targetName: partial.name.toLowerCase(),
    metadata: null,
    ...partial,
  };
}

describe("parentTableRef", () => {
  test("reads metadata.tableName", () => {
    expect(
      parentTableRef(
        row({
          id: "i1",
          name: "TLG_DAILY_TMP_1_IDX01",
          objectType: "INDEX",
          metadata: { tableName: "TLG_DAILY_TMP_1" },
        }),
      ),
    ).toEqual({ owner: "WMS1", name: "TLG_DAILY_TMP_1" });
  });

  test("parses ON schema.table from SQL", () => {
    expect(
      parentTableRef(
        row({
          id: "i1",
          name: "IDX",
          objectType: "INDEX",
          targetSql: "CREATE INDEX idx ON wms1.tlg_daily_tmp_1 (id)",
        }),
      ),
    ).toEqual({ owner: "WMS1", name: "TLG_DAILY_TMP_1" });
  });
});

describe("selectDeployableWithParents", () => {
  test("force-includes REVIEW parent TABLE that still has VALIDATED SQL", () => {
    const index = row({
      id: "idx",
      name: "TLG_DAILY_TMP_1_IDX01",
      objectType: "INDEX",
      metadata: { tableName: "TLG_DAILY_TMP_1" },
      targetSql: "CREATE INDEX tlg_daily_tmp_1_idx01 ON wms1.tlg_daily_tmp_1 (id)",
    });
    const blocked = row({
      id: "tbl",
      name: "TLG_DAILY_TMP_1",
      objectType: "TABLE",
      reconcileAction: "REVIEW_REQUIRED",
      targetState: "TARGET_DRIFTED",
      targetSql: "CREATE UNLOGGED TABLE wms1.tlg_daily_tmp_1 (id int)",
    });
    const result = selectDeployableWithParents({ members: [index, blocked] });
    expect(result.selected.map((item) => item.id).sort()).toEqual(["idx", "tbl"]);
    expect(result.skippedDependents).toEqual([]);
  });

  test("pulls parent TABLE from catalog when missing from run members", () => {
    const index = row({
      id: "idx",
      name: "TLG_DAILY_TMP_1_IDX01",
      objectType: "INDEX",
      metadata: { tableName: "TLG_DAILY_TMP_1" },
    });
    const catalogTable = row({
      id: "tbl",
      name: "TLG_DAILY_TMP_1",
      objectType: "TABLE",
      targetSql: "CREATE UNLOGGED TABLE wms1.tlg_daily_tmp_1 (id int)",
    });
    const catalog = new Map([["WMS1.TLG_DAILY_TMP_1", [catalogTable]]]);
    const result = selectDeployableWithParents({
      members: [index],
      catalogRelationsByOwnerName: catalog,
    });
    expect(result.selected.map((item) => item.id).sort()).toEqual(["idx", "tbl"]);
  });

  test("force-includes tables referenced by VIEW SQL", () => {
    const view = row({
      id: "view",
      name: "VCO_BSUSER",
      objectType: "VIEW",
      targetSql: `CREATE OR REPLACE VIEW wms1.vco_bsuser AS SELECT * FROM tes_user t JOIN wms1.tac_abpl a ON 1=1`,
    });
    const tesUser = row({
      id: "t1",
      name: "TES_USER",
      objectType: "TABLE",
      targetSql: "CREATE TABLE wms1.tes_user (id int)",
    });
    const tacAbpl = row({
      id: "t2",
      name: "TAC_ABPL",
      objectType: "TABLE",
      reconcileAction: "SKIP_UNCHANGED",
      targetSql: "CREATE TABLE wms1.tac_abpl (id int)",
    });
    const result = selectDeployableWithParents({ members: [view, tesUser, tacAbpl] });
    expect(result.selected.map((item) => item.id).sort()).toEqual(["t1", "t2", "view"]);
  });

  test("accepts parent VIEW and explains include≠validated", () => {
    const child = row({
      id: "v2",
      name: "VLG_PO_EXPECTSTOCK",
      objectType: "VIEW",
      targetSql: "CREATE VIEW wms1.vlg_po_expectstock AS SELECT * FROM vlg_po_pur_order",
    });
    const parentView = row({
      id: "v1",
      name: "VLG_PO_PUR_ORDER",
      objectType: "VIEW",
      status: "REVIEW_REQUIRED",
      targetSql: "CREATE VIEW wms1.vlg_po_pur_order AS SELECT 1",
    });
    const result = selectDeployableWithParents({ members: [child, parentView] });
    expect(result.selected.map((item) => item.id)).toEqual([]);
    expect(result.parentIssues[0]?.reason).toBe("not_validated");
    expect(formatParentIssue(result.parentIssues[0]!)).toContain("not VALIDATED");
  });
});
