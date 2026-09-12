import { describe, expect, test } from "bun:test";
import { OracleReadOnlyViolationError } from "@migrator/shared";
import { OracleReadOnlyClient } from "./read-only-client";
import { classifyOracleSql } from "./sql-classifier";
import type { OracleDriver, OracleSourceConfig } from "./types";

const baseConfig: OracleSourceConfig = {
  displayName: "CLV",
  host: "oracle.internal",
  port: 1521,
  connectType: "SERVICE_NAME",
  serviceName: "CLV",
  username: "migrator_ro",
  password: "secret",
  schemas: ["CLV"],
  connectionTimeoutMs: 5000,
  statementTimeoutMs: 5000,
};

function trackingDriver(calls: string[]): OracleDriver {
  return {
    async getConnection() {
      calls.push("getConnection");
      return {
        async execute(sql: string) {
          calls.push(sql);
          return { rows: [] };
        },
        async close() {
          calls.push("close");
        },
      };
    },
  };
}

describe("classifyOracleSql", () => {
  test("allows SELECT", () => {
    const result = classifyOracleSql("SELECT 1 FROM DUAL");
    expect(result.kind).toBe("SELECT");
  });

  test("allows SELECT after comments", () => {
    const result = classifyOracleSql(
      "-- update something\n/* DELETE FROM t */ SELECT id FROM orders",
    );
    expect(result.kind).toBe("SELECT");
  });

  test("allows WITH ... SELECT", () => {
    const result = classifyOracleSql("WITH x AS (SELECT 1 AS n FROM DUAL) SELECT n FROM x");
    expect(result.kind).toBe("SELECT");
  });

  test("rejects UPDATE before reaching Oracle", () => {
    expect(classifyOracleSql("UPDATE orders SET status = 'X'").kind).toBe("REJECTED");
  });

  test("rejects DELETE", () => {
    expect(classifyOracleSql("DELETE FROM orders").kind).toBe("REJECTED");
  });

  test("rejects CREATE TABLE", () => {
    expect(classifyOracleSql("CREATE TABLE t (id NUMBER)").kind).toBe("REJECTED");
  });

  test("rejects PL/SQL blocks", () => {
    expect(classifyOracleSql("BEGIN UPDATE orders SET status = 'X'; END;").kind).toBe("REJECTED");
  });

  test("rejects INSERT hidden after a comment", () => {
    expect(classifyOracleSql("/* SELECT 1 */ INSERT INTO t VALUES (1)").kind).toBe("REJECTED");
  });

  test("rejects multiple statements", () => {
    expect(classifyOracleSql("SELECT 1 FROM DUAL; DELETE FROM orders").kind).toBe("REJECTED");
  });

  test("rejects SELECT FOR UPDATE", () => {
    expect(classifyOracleSql("SELECT * FROM orders FOR UPDATE").kind).toBe("REJECTED");
  });

  test("rejects GRANT", () => {
    expect(classifyOracleSql("GRANT SELECT ON orders TO public").kind).toBe("REJECTED");
  });
});

describe("OracleReadOnlyClient", () => {
  test("does not open an Oracle session for UPDATE", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await expect(client.executeValidationSelect("UPDATE t SET x = 1")).rejects.toBeInstanceOf(
      OracleReadOnlyViolationError,
    );
    expect(calls).toEqual([]);
  });

  test("does not open an Oracle session for DELETE", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await expect(client.executeValidationSelect("DELETE FROM t")).rejects.toBeInstanceOf(
      OracleReadOnlyViolationError,
    );
    expect(calls).toEqual([]);
  });

  test("does not open an Oracle session for CREATE TABLE", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await expect(
      client.executeValidationSelect("CREATE TABLE t (id NUMBER)"),
    ).rejects.toBeInstanceOf(OracleReadOnlyViolationError);
    expect(calls).toEqual([]);
  });

  test("does not open an Oracle session for BEGIN/END PL/SQL", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await expect(client.executeValidationSelect("BEGIN NULL; END;")).rejects.toBeInstanceOf(
      OracleReadOnlyViolationError,
    );
    expect(calls).toEqual([]);
  });

  test("opens Oracle only after SELECT is classified", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await client.executeValidationSelect("SELECT 1 FROM DUAL");
    expect(calls[0]).toBe("getConnection");
    expect(calls.some((call) => call.startsWith("SELECT"))).toBe(true);
  });

  test("lists object owners even when ALL_USERS is incomplete", async () => {
    const client = new OracleReadOnlyClient(baseConfig, {
      async getConnection() {
        return {
          async execute(sql: string) {
            if (sql.includes("SELECT USER FROM DUAL")) {
              return { rows: [["WMS1"]] };
            }
            if (sql.includes("DISTINCT OWNER")) {
              return { rows: [["WMS1"], ["HR"], ["CLV"], ["SYS"]] };
            }
            if (sql.includes("ALL_USERS")) {
              return { rows: [["WMS1"], ["AJHCMWCS"], ["DBAUSER"], ["GSMROOTUSER"], ["SYS"]] };
            }
            return { rows: [] };
          },
          async close() {
            return undefined;
          },
        };
      },
    });
    const catalog = await client.listSchemaCatalog();
    expect(catalog.sessionUser).toBe("WMS1");
    expect(catalog.schemas).toEqual(["AJHCMWCS", "CLV", "DBAUSER", "HR", "WMS1"]);
  });

  test("readTableChunk classifies SELECT before opening a session", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, trackingDriver(calls));
    await client.readTableChunk({
      owner: "HR",
      name: "EMP",
      columns: ["EMPNO"],
      offset: 0,
      limit: 10,
    });
    expect(calls[0]).toBe("getConnection");
    expect(calls.some((call) => call.includes("FETCH NEXT 10 ROWS ONLY"))).toBe(true);
    expect(calls.some((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call))).toBe(false);
  });

  test("discovers objects through classified SELECT only", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, {
      async getConnection() {
        calls.push("getConnection");
        return {
          async execute(sql: string) {
            calls.push(sql);
            if (sql.includes("ALL_OBJECTS")) {
              return { rows: [["CLV", "ORDERS", "TABLE", "VALID", new Date()]] };
            }
            return { rows: [] };
          },
          async close() {
            calls.push("close");
          },
        };
      },
    });
    const objects = await client.discoverObjects(["CLV"]);
    expect(objects[0]?.name).toBe("ORDERS");
    expect(calls[0]).toBe("getConnection");
    expect(calls.some((call) => call.includes("UPDATE"))).toBe(false);
    expect(calls.at(-1)).toBe("close");
  });

  test("reports catalog before GET_DDL during inventory", async () => {
    const order: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, {
      async getConnection() {
        return {
          async execute(sql: string) {
            if (sql.includes("DBMS_METADATA.GET_DDL")) {
              order.push("ddl");
              if (sql.includes("ALL_OBJECTS")) {
                return { rows: [["ORDERS", "CREATE TABLE CLV.ORDERS (ID NUMBER)"]] };
              }
              return { rows: [["CREATE TABLE CLV.ORDERS (ID NUMBER)"]] };
            }
            if (sql.includes("ALL_OBJECTS")) {
              return { rows: [["CLV", "ORDERS", "TABLE", "VALID", new Date()]] };
            }
            return { rows: [] };
          },
          async close() {
            return undefined;
          },
        };
      },
    });
    await client.discoverInventory(["CLV"], new Map(), {
      onCatalog: () => {
        order.push("catalog");
      },
      onDefinition: () => {
        order.push("definition");
      },
      onDependencies: () => {
        order.push("dependencies");
      },
    });
    expect(order[0]).toBe("catalog");
    expect(order.indexOf("catalog")).toBeLessThan(order.indexOf("ddl"));
    expect(order.indexOf("ddl")).toBeLessThan(order.indexOf("definition"));
    expect(order.at(-1)).toBe("dependencies");
  });

  test("does not call GET_DDL for indexes built from the dictionary", async () => {
    const calls: string[] = [];
    const client = new OracleReadOnlyClient(baseConfig, {
      async getConnection() {
        return {
          async execute(sql: string) {
            calls.push(sql);
            if (sql.includes("ALL_OBJECTS") && !sql.includes("GET_DDL")) {
              return {
                rows: [["CLV", "IDX_ORDERS", "INDEX", "VALID", new Date()]],
              };
            }
            if (sql.includes("ALL_INDEXES")) {
              return { rows: [["CLV", "IDX_ORDERS", "ORDERS", "NONUNIQUE", "VALID", "NORMAL"]] };
            }
            if (sql.includes("ALL_IND_COLUMNS")) {
              return { rows: [["CLV", "IDX_ORDERS", "STATUS", 1, "ASC"]] };
            }
            return { rows: [] };
          },
          async close() {
            return undefined;
          },
        };
      },
    });
    const result = await client.discoverInventory(["CLV"]);
    expect(result.definitions.get("CLV.IDX_ORDERS.INDEX")?.source).toContain("CREATE INDEX");
    expect(calls.some((sql) => sql.includes("DBMS_METADATA.GET_DDL"))).toBe(false);
  });

  test("returns ok:false when the driver cannot connect", async () => {
    const client = new OracleReadOnlyClient(baseConfig, {
      async getConnection() {
        throw new Error(
          "NJS-503: connection to host oracle.internal port 1521 could not be established",
        );
      },
    });
    const result = await client.testConnection();
    expect(result.ok).toBe(false);
    expect(result.engine).toBe("ORACLE");
    expect(result.accessMode).toBe("READ_ONLY");
    expect(result.message).toContain("NJS-503");
  });
});
