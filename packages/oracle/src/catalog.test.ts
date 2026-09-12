import { describe, expect, test } from "bun:test";
import {
  buildBatchDdlSql,
  collectCatalog,
  collectDependencies,
  extractDefinition,
  GET_DDL_BATCH_SIZE,
  hashSource,
  synthesizeConstraintSource,
  synthesizeIndexSource,
} from "./catalog";
import { CATALOG_SQL } from "./catalog-sql";
import { classifyOracleSql } from "./sql-classifier";

function selectFrom(handlers: Record<string, unknown[][]> | ((sql: string) => unknown[][])) {
  return async (sql: string): Promise<unknown[][]> => {
    if (typeof handlers === "function") {
      return handlers(sql);
    }
    for (const [fragment, rows] of Object.entries(handlers)) {
      if (sql.includes(fragment)) {
        return rows;
      }
    }
    return [];
  };
}

describe("catalog SQL", () => {
  test("every catalog statement is a classified SELECT", () => {
    for (const [name, sql] of Object.entries(CATALOG_SQL)) {
      const result = classifyOracleSql(sql);
      expect(result.kind, `${name} must be SELECT`).toBe("SELECT");
    }
  });

  test("batched GET_DDL is a classified SELECT", () => {
    const result = classifyOracleSql(buildBatchDdlSql(GET_DDL_BATCH_SIZE));
    expect(result.kind).toBe("SELECT");
  });
});

describe("collectCatalog", () => {
  test("builds table inventory with columns, row counts, and partitions", async () => {
    const objects = await collectCatalog(
      selectFrom({
        ALL_OBJECTS: [["CLV", "ORDERS", "TABLE", "VALID", new Date("2026-01-01T00:00:00Z")]],
        ALL_CONSTRAINTS: [["CLV", "PK_ORDERS", "P", "ORDERS", "ENABLED"]],
        ALL_TAB_COLUMNS: [
          ["CLV", "ORDERS", "ID", "NUMBER", 22, 18, 0, "N", 1],
          ["CLV", "ORDERS", "STATUS", "VARCHAR2", 32, null, null, "Y", 2],
        ],
        ALL_TABLES: [["CLV", "ORDERS", 1500, 4]],
        ALL_TAB_PARTITIONS: [["CLV", "ORDERS", "P2026", 1]],
        ALL_INDEXES: [],
        ALL_SCHEDULER_JOBS: [],
        ALL_DB_LINKS: [],
      }),
      ["CLV"],
    );

    expect(objects).toHaveLength(2);
    const table = objects.find((object) => object.objectType === "TABLE");
    expect(table?.name).toBe("ORDERS");
    expect(table?.estimatedRowCount).toBe(1500);
    expect(table?.byteSize).toBe(32768);
    expect(table?.metadata.columns).toHaveLength(2);
    expect(table?.metadata.partitions?.[0]?.name).toBe("P2026");
    expect(objects.some((object) => object.objectType === "CONSTRAINT")).toBe(true);
  });

  test("keeps table byte size above 32-bit integer range", async () => {
    const objects = await collectCatalog(
      selectFrom({
        ALL_OBJECTS: [["WMS1", "TLG_WMS_DAILY_ITEM_LOG", "TABLE", "VALID", new Date()]],
        ALL_CONSTRAINTS: [],
        ALL_TAB_COLUMNS: [],
        ALL_TABLES: [["WMS1", "TLG_WMS_DAILY_ITEM_LOG", 13901691, 434414]],
        ALL_TAB_PARTITIONS: [],
        ALL_INDEXES: [],
        ALL_SCHEDULER_JOBS: [],
        ALL_DB_LINKS: [],
      }),
      ["WMS1"],
    );
    expect(objects[0]?.byteSize).toBe(3558719488);
    expect(objects[0]?.byteSize).toBeGreaterThan(2147483647);
  });

  test("fills missing table stats from partitions and allocated segments", async () => {
    const objects = await collectCatalog(
      selectFrom({
        ALL_OBJECTS: [
          ["CLV", "EVENTS", "TABLE", "VALID", new Date("2026-01-01T00:00:00Z")],
          ["CLV", "IDX_EVENTS", "INDEX", "VALID", new Date("2026-01-01T00:00:00Z")],
        ],
        ALL_CONSTRAINTS: [],
        ALL_TAB_COLUMNS: [],
        ALL_TABLES: [["CLV", "EVENTS", null, null]],
        ALL_TAB_PARTITIONS: [
          ["CLV", "EVENTS", "P1", 1, 100, 2],
          ["CLV", "EVENTS", "P2", 2, 250, 3],
        ],
        ALL_LOBS: [["CLV", "EVENTS", "SYS_LOB_EVENTS", "SYS_IL_EVENTS"]],
        ALL_SEGMENTS: [
          ["CLV", "EVENTS", "TABLE PARTITION", 16384],
          ["CLV", "EVENTS", "TABLE PARTITION", 24576],
          ["CLV", "SYS_LOB_EVENTS", "LOBSEGMENT", 8192],
          ["CLV", "IDX_EVENTS", "INDEX", 4096],
        ],
        ALL_INDEXES: [["CLV", "IDX_EVENTS", "EVENTS", "NONUNIQUE", "VALID", "NORMAL"]],
        ALL_SCHEDULER_JOBS: [],
        ALL_DB_LINKS: [],
      }),
      ["CLV"],
    );
    const table = objects.find((object) => object.objectType === "TABLE");
    const index = objects.find((object) => object.objectType === "INDEX");
    expect(table?.estimatedRowCount).toBe(350);
    expect(table?.byteSize).toBe(49152);
    expect(index?.byteSize).toBe(4096);
  });

  test("synthesizes index and primary-key DDL from dictionary rows", async () => {
    const objects = await collectCatalog(
      selectFrom({
        ALL_OBJECTS: [
          ["CLV", "ORDERS", "TABLE", "VALID", new Date("2026-01-01T00:00:00Z")],
          ["CLV", "IDX_ORDERS_STATUS", "INDEX", "VALID", new Date("2026-01-01T00:00:00Z")],
        ],
        ALL_CONSTRAINTS: [["CLV", "PK_ORDERS", "P", "ORDERS", "ENABLED", null, null, null, null]],
        ALL_CONS_COLUMNS: [["CLV", "PK_ORDERS", "ID", 1]],
        ALL_TAB_COLUMNS: [["CLV", "ORDERS", "ID", "NUMBER", 22, 18, 0, "N", 1]],
        ALL_TABLES: [["CLV", "ORDERS", 10, 1]],
        ALL_TAB_PARTITIONS: [],
        ALL_INDEXES: [["CLV", "IDX_ORDERS_STATUS", "ORDERS", "NONUNIQUE", "VALID", "NORMAL"]],
        ALL_IND_COLUMNS: [["CLV", "IDX_ORDERS_STATUS", "STATUS", 1, "ASC"]],
        ALL_SOURCE: [],
        ALL_SCHEDULER_JOBS: [],
        ALL_DB_LINKS: [],
      }),
      ["CLV"],
    );
    const index = objects.find((object) => object.objectType === "INDEX");
    const constraint = objects.find((object) => object.objectType === "CONSTRAINT");
    expect(index?.inlineDefinition?.source).toContain("CREATE INDEX");
    expect(index?.inlineDefinition?.source).toContain("IDX_ORDERS_STATUS");
    expect(constraint?.inlineDefinition?.source).toContain("PRIMARY KEY");
  });

  test("keeps tables when optional dictionary views are missing", async () => {
    const objects = await collectCatalog(
      async (sql) => {
        if (
          sql.includes("ALL_SEGMENTS") ||
          sql.includes("ALL_LOBS") ||
          sql.includes("ALL_TAB_PARTITIONS") ||
          sql.includes("ALL_SCHEDULER_JOBS") ||
          sql.includes("ALL_DB_LINKS") ||
          sql.includes("ALL_SOURCE")
        ) {
          throw new Error("ORA-00942: table or view does not exist");
        }
        if (sql.includes("ALL_OBJECTS")) {
          return [["WMS1", "ORDERS", "TABLE", "VALID", new Date("2026-01-01T00:00:00Z")]];
        }
        if (sql.includes("ALL_TABLES")) {
          return [["WMS1", "ORDERS", 10, 1]];
        }
        return [];
      },
      ["WMS1"],
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.name).toBe("ORDERS");
    expect(objects[0]?.estimatedRowCount).toBe(10);
    expect(objects[0]?.byteSize).toBe(8192);
  });

  test("falls back to SEARCH_CONDITION when SEARCH_CONDITION_VC is missing", async () => {
    const objects = await collectCatalog(
      async (sql) => {
        if (sql.includes("SEARCH_CONDITION_VC")) {
          throw new Error('ORA-00904: "SEARCH_CONDITION_VC": invalid identifier');
        }
        if (sql.includes("ALL_CONSTRAINTS")) {
          return [["CLV", "CK_ORDERS", "C", "ORDERS", "ENABLED", "STATUS IS NOT NULL"]];
        }
        if (sql.includes("ALL_OBJECTS")) {
          return [["CLV", "ORDERS", "TABLE", "VALID", new Date("2026-01-01T00:00:00Z")]];
        }
        return [];
      },
      ["CLV"],
    );
    const constraint = objects.find((object) => object.objectType === "CONSTRAINT");
    expect(constraint?.metadata.searchCondition).toBe("STATUS IS NOT NULL");
  });
});

describe("extractDefinition", () => {
  test("hashes GET_DDL output", async () => {
    const ddl = "CREATE TABLE CLV.ORDERS (ID NUMBER)";
    const definition = await extractDefinition(
      selectFrom({
        "DBMS_METADATA.GET_DDL": [[ddl]],
      }),
      { owner: "CLV", name: "ORDERS", objectType: "TABLE" },
    );
    expect(definition.source).toBe(ddl);
    expect(definition.hash).toBe(hashSource(ddl));
    expect(definition.skipped).toBe(false);
  });
});

describe("synthesize DDL", () => {
  test("builds unique index and foreign key text", () => {
    expect(
      synthesizeIndexSource({
        owner: "CLV",
        name: "UK_ORDERS",
        tableName: "ORDERS",
        uniqueness: "UNIQUE",
        indexType: "NORMAL",
        columns: [{ name: "CODE" }],
      }),
    ).toBe('CREATE UNIQUE INDEX "CLV"."UK_ORDERS" ON "CLV"."ORDERS" ("CODE")');
    expect(
      synthesizeConstraintSource({
        owner: "CLV",
        name: "FK_ORDERS_CUST",
        tableName: "ORDERS",
        constraintType: "R",
        columns: ["CUSTOMER_ID"],
        referencedOwner: "CLV",
        referencedTable: "CUSTOMERS",
        referencedColumns: ["ID"],
        deleteRule: "CASCADE",
      }),
    ).toContain("FOREIGN KEY");
  });
});

describe("collectDependencies", () => {
  test("maps dictionary types", async () => {
    const dependencies = await collectDependencies(
      selectFrom({
        ALL_DEPENDENCIES: [["CLV", "V_ORDERS", "VIEW", "CLV", "ORDERS", "TABLE", "HARD"]],
      }),
      ["clv"],
    );
    expect(dependencies).toEqual([
      {
        owner: "CLV",
        name: "V_ORDERS",
        objectType: "VIEW",
        referencedOwner: "CLV",
        referencedName: "ORDERS",
        referencedType: "TABLE",
        dependencyType: "HARD",
      },
    ]);
  });

  test("collapses duplicate dictionary rows", async () => {
    const dependencies = await collectDependencies(
      selectFrom({
        ALL_DEPENDENCIES: [
          ["CLV", "V_ORDERS", "VIEW", "CLV", "ORDERS", "TABLE", "HARD"],
          ["CLV", "V_ORDERS", "VIEW", "CLV", "ORDERS", "TABLE", "HARD"],
        ],
      }),
      ["clv"],
    );
    expect(dependencies).toHaveLength(1);
  });

  test("returns no dependencies when ALL_DEPENDENCIES is missing", async () => {
    const dependencies = await collectDependencies(async () => {
      throw new Error("ORA-00942: table or view does not exist");
    }, ["CLV"]);
    expect(dependencies).toEqual([]);
  });
});
