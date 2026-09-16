import { describe, expect, test } from "bun:test";
import { ORACLE_OBJECT_TYPES } from "./enums";
import type { UpsertScopeInput } from "./schemas";
import {
  evaluateScopeObject,
  forceIncludeObjectsInScope,
  matchesGlob,
  objectMatchesPattern,
  refsIncludedInScope,
  selectDataTables,
  buildScopePreview,
} from "./scope";

const rules: UpsertScopeInput = {
  includeSchemas: ["CLV"],
  includeObjectTypes: [...ORACLE_OBJECT_TYPES],
  includeNamePatterns: ["ORDER_*", "SHIPMENT_*"],
  excludeNamePatterns: ["*_HISTORY", "TMP_*", "BACKUP_*"],
  excludeObjects: ["CLV.OLD_ORDER", "CLV.PKG_LEGACY"],
  dataMode: "ALL_SELECTED_TABLES",
  selectedTables: [],
};

function obj(
  id: string,
  owner: string,
  name: string,
  objectType: UpsertScopeInput["includeObjectTypes"][number] = "TABLE",
) {
  return { id, owner, name, objectType };
}

describe("scope matching", () => {
  test("ORDER_* include and *_HISTORY exclude follow spec examples", () => {
    expect(evaluateScopeObject(obj("1", "CLV", "ORDER_ITEMS"), rules).included).toBe(true);
    expect(evaluateScopeObject(obj("2", "CLV", "SHIPMENT_STOPS"), rules).included).toBe(true);
    expect(evaluateScopeObject(obj("3", "CLV", "ORDER_HISTORY"), rules).reason).toBe(
      "exclude_pattern",
    );
    expect(evaluateScopeObject(obj("4", "CLV", "TMP_LOAD"), rules).reason).toBe("exclude_pattern");
    expect(evaluateScopeObject(obj("5", "CLV", "CUSTOMER"), rules).reason).toBe("include_pattern");
  });

  test("forceIncludeObjectsInScope removes matching exclude globs for one table only", () => {
    const catalog = [
      obj("1", "WMS1", "TCO_ABCODE_NO_USE"),
      obj("2", "WMS1", "TCO_ABCODEGRP_NO_USE"),
      obj("3", "WMS1", "TCO_ABCODE"),
    ];
    const next = forceIncludeObjectsInScope(
      {
        includeSchemas: ["WMS1"],
        includeObjectTypes: [...ORACLE_OBJECT_TYPES],
        includeNamePatterns: [],
        excludeNamePatterns: ["*_NO_USE"],
        excludeObjects: [],
        dataMode: "NONE",
        selectedTables: [],
      },
      catalog,
      [{ owner: "WMS1", name: "TCO_ABCODE_NO_USE" }],
    );
    expect(evaluateScopeObject(catalog[0]!, next).included).toBe(true);
    expect(evaluateScopeObject(catalog[1]!, next).included).toBe(false);
    expect(evaluateScopeObject(catalog[2]!, next).included).toBe(true);
    expect(next.excludeNamePatterns).not.toContain("*_NO_USE");
    expect(next.excludeObjects).toContain("WMS1.TCO_ABCODEGRP_NO_USE");
  });

  test("forceIncludeObjectsInScope appends allow-list entries so excluded-by-include tables enter scope", () => {
    const catalog = [
      obj("1", "WMS1", "ORDERS"),
      obj("2", "WMS1", "TLG_DAILY_TMP_1"),
      obj("3", "WMS1", "TLG_DAILY_TMP_1_IDX01", "INDEX"),
    ];
    const before = {
      includeSchemas: ["WMS1"],
      includeObjectTypes: [...ORACLE_OBJECT_TYPES],
      includeNamePatterns: ["ORDERS", "TLG_DAILY_TMP_1_IDX01"],
      excludeNamePatterns: [],
      excludeObjects: [],
      dataMode: "NONE" as const,
      selectedTables: [],
    };
    expect(evaluateScopeObject(catalog[1]!, before).included).toBe(false);
    expect(evaluateScopeObject(catalog[1]!, before).reason).toBe("include_pattern");
    const next = forceIncludeObjectsInScope(before, catalog, [
      { owner: "WMS1", name: "TLG_DAILY_TMP_1" },
    ]);
    expect(evaluateScopeObject(catalog[1]!, next).included).toBe(true);
    expect(next.includeNamePatterns).toContain("WMS1.TLG_DAILY_TMP_1");
    // Must not collapse allow-list to only the forced table.
    expect(evaluateScopeObject(catalog[0]!, next).included).toBe(true);
    expect(refsIncludedInScope(next, ["WMS1.TLG_DAILY_TMP_1", "WMS1.MISSING"])).toEqual([
      "WMS1.TLG_DAILY_TMP_1",
    ]);
  });

  test("exact exclusions match OWNER.NAME", () => {
    expect(evaluateScopeObject(obj("1", "CLV", "OLD_ORDER"), rules).reason).toBe("exact_exclusion");
    expect(evaluateScopeObject(obj("2", "CLV", "PKG_LEGACY", "PACKAGE"), rules).reason).toBe(
      "exact_exclusion",
    );
  });

  test("schema and type gates exclude before name patterns", () => {
    expect(evaluateScopeObject(obj("1", "HR", "ORDER_ITEMS"), rules).reason).toBe("schema");
    expect(
      evaluateScopeObject(obj("2", "CLV", "ORDER_ITEMS", "VIEW"), {
        ...rules,
        includeObjectTypes: ["TABLE"],
      }).reason,
    ).toBe("object_type");
  });

  test("empty schema or type lists select nothing", () => {
    expect(
      evaluateScopeObject(obj("1", "CLV", "ORDERS"), { ...rules, includeSchemas: [] }).included,
    ).toBe(false);
    expect(
      evaluateScopeObject(obj("1", "CLV", "ORDERS"), { ...rules, includeObjectTypes: [] }).included,
    ).toBe(false);
  });

  test("OWNER.NAME patterns match qualified names", () => {
    expect(objectMatchesPattern({ owner: "CLV", name: "ORDER_ITEMS" }, "CLV.ORDER_*")).toBe(true);
    expect(objectMatchesPattern({ owner: "HR", name: "ORDER_ITEMS" }, "CLV.ORDER_*")).toBe(false);
  });

  test("glob anchors so *_HISTORY does not match ORDER_HISTORY_X", () => {
    expect(matchesGlob("ORDER_HISTORY", "*_HISTORY")).toBe(true);
    expect(matchesGlob("ORDER_HISTORY_X", "*_HISTORY")).toBe(false);
  });

  test("preview reports found/selected/excluded per type and lists included objects", () => {
    const preview = buildScopePreview(
      [
        obj("1", "CLV", "ORDER_ITEMS"),
        obj("2", "CLV", "ORDER_HISTORY"),
        obj("3", "CLV", "V_ORDERS", "VIEW"),
        obj("4", "HR", "EMPLOYEES"),
      ],
      { ...rules, includeNamePatterns: [] },
      { inclusion: "included", page: 1, pageSize: 50 },
    );
    expect(preview.totals).toEqual({ found: 4, selected: 2, excluded: 2 });
    expect(preview.byType.TABLE).toEqual({ found: 3, selected: 1, excluded: 2 });
    expect(preview.byType.VIEW).toEqual({ found: 1, selected: 1, excluded: 0 });
    expect(preview.objects.map((row) => row.name).sort()).toEqual(["ORDER_ITEMS", "V_ORDERS"]);
  });

  test("previews a large exact allow-list without scanning every pattern per object", () => {
    const objects = Array.from({ length: 20_000 }, (_, index) =>
      obj(String(index), "WMS1", `TBL_${index}`, index % 2 === 0 ? "TABLE" : "CONSTRAINT"),
    );
    const includeNamePatterns = objects.slice(0, 2_500).map((object) => object.name);
    const started = performance.now();
    const preview = buildScopePreview(
      objects,
      {
        ...rules,
        includeSchemas: ["WMS1"],
        includeNamePatterns,
        excludeNamePatterns: ["*_HISTORY"],
        excludeObjects: [],
      },
      { inclusion: "included", page: 1, pageSize: 50 },
    );
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(preview.totals.selected).toBe(2_500);
    expect(preview.totals.found).toBe(20_000);
  });

  test("data mode NONE copies no tables; ALL_SELECTED_TABLES uses included tables", () => {
    const included = [
      evaluateScopeObject(obj("1", "CLV", "ORDER_ITEMS"), { ...rules, includeNamePatterns: [] }),
      evaluateScopeObject(obj("2", "CLV", "V_ORDERS", "VIEW"), {
        ...rules,
        includeNamePatterns: [],
      }),
    ];
    expect(selectDataTables(included, "NONE", []).map((row) => row.name)).toEqual([]);
    expect(selectDataTables(included, "ALL_SELECTED_TABLES", []).map((row) => row.name)).toEqual([
      "ORDER_ITEMS",
    ]);
    expect(
      selectDataTables(included, "SELECTED_TABLES", ["CLV.MISSING"]).map((row) => row.name),
    ).toEqual([]);
    expect(
      selectDataTables(included, "SELECTED_TABLES", ["CLV.ORDER_ITEMS"]).map((row) => row.name),
    ).toEqual(["ORDER_ITEMS"]);
  });
});
