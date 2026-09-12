import { describe, expect, test } from "bun:test";
import { ORACLE_OBJECT_TYPES } from "@migrator/shared";
import { ScopeService } from "./scope.service";

describe("ScopeService", () => {
  test("preview applies saved-style rules without writing", async () => {
    const service = new ScopeService(
      { getByIdOrThrow: async () => ({ id: "p1" }) } as never,
      { listByProject: async () => [] } as never,
      {
        listCatalog: async () => [
          {
            id: "11111111-1111-1111-1111-111111111111",
            owner: "CLV",
            name: "ORDER_ITEMS",
            objectType: "TABLE",
          },
          {
            id: "22222222-2222-2222-2222-222222222222",
            owner: "CLV",
            name: "ORDER_HISTORY",
            objectType: "TABLE",
          },
          {
            id: "33333333-3333-3333-3333-333333333333",
            owner: "CLV",
            name: "V_ORDERS",
            objectType: "VIEW",
          },
        ],
      } as never,
      { getByProjectId: async () => undefined } as never,
      { append: async () => undefined } as never,
    );

    const preview = await service.preview(
      "p1",
      {
        includeSchemas: ["CLV"],
        includeObjectTypes: [...ORACLE_OBJECT_TYPES],
        includeNamePatterns: ["ORDER_*"],
        excludeNamePatterns: ["*_HISTORY"],
        excludeObjects: [],
        dataMode: "ALL_SELECTED_TABLES",
        selectedTables: [],
      },
      { page: 1, pageSize: 20, inclusion: "included" },
    );

    expect(preview.totals).toEqual({ found: 3, selected: 1, excluded: 2 });
    expect(preview.objects).toHaveLength(1);
    expect(preview.objects[0]?.name).toBe("ORDER_ITEMS");
    expect(preview.data.selectedTableCount).toBe(1);
    expect(preview.scope.saved).toBe(false);
  });
});
