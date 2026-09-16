import { describe, expect, test } from "bun:test";
import {
  createOracleConnectionSchema,
  listDiscoveredObjectsQuerySchema,
  objectDagQuerySchema,
  startConversionSchema,
  startDeploySchema,
  upsertScopeSchema,
} from "./schemas";

describe("createOracleConnectionSchema", () => {
  test("rejects allowWrite instead of accepting a write-enabled source", () => {
    const result = createOracleConnectionSchema.safeParse({
      displayName: "CLV Oracle",
      host: "127.0.0.1",
      port: 1521,
      connectType: "SERVICE_NAME",
      serviceName: "CLV",
      username: "migrator_ro",
      password: "secret",
      schemas: ["CLV"],
      allowWrite: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("upsertScopeSchema", () => {
  test("rejects unknown fields", () => {
    const result = upsertScopeSchema.safeParse({
      includeSchemas: ["CLV"],
      includeObjectTypes: ["TABLE"],
      includeNamePatterns: [],
      excludeNamePatterns: [],
      excludeObjects: [],
      dataMode: "NONE",
      selectedTables: [],
      allowWrite: true,
    });
    expect(result.success).toBe(false);
  });

  test("accepts a large pasted include-name allow list", () => {
    const result = upsertScopeSchema.safeParse({
      includeSchemas: ["WMS1"],
      includeObjectTypes: ["TABLE"],
      includeNamePatterns: Array.from({ length: 2500 }, (_, index) => `TLG_TABLE_${index}`),
      excludeNamePatterns: [],
      excludeObjects: [],
      dataMode: "NONE",
      selectedTables: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("objectDagQuerySchema", () => {
  test("parses comma-separated tracks", () => {
    const parsed = objectDagQuerySchema.parse({ tracks: "SCHEMA,PLSQL" });
    expect(parsed.tracks).toEqual(["SCHEMA", "PLSQL"]);
    expect(objectDagQuerySchema.parse({ tracks: "" }).tracks).toEqual([]);
  });
});

describe("startConversionSchema", () => {
  test("defaults to FAST and rejects unknown fields", () => {
    const ok = startConversionSchema.safeParse({});
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.strategy).toBe("FAST");
      expect(ok.data.tracks).toEqual(["SCHEMA"]);
    }
    const withTracks = startConversionSchema.safeParse({
      strategy: "FAST",
      tracks: ["SCHEMA", "PLSQL"],
    });
    expect(withTracks.success).toBe(true);
    const bad = startConversionSchema.safeParse({ strategy: "FAST", allowWrite: true });
    expect(bad.success).toBe(false);
  });
});

describe("startDeploySchema", () => {
  test("accepts an empty body and rejects unknown fields", () => {
    expect(startDeploySchema.safeParse({}).success).toBe(true);
    expect(startDeploySchema.safeParse({ confirm: true }).success).toBe(false);
  });
});

describe("listDiscoveredObjectsQuerySchema", () => {
  test("defaults sort and accepts inventory filters", () => {
    const parsed = listDiscoveredObjectsQuerySchema.parse({
      owner: "WMS1",
      extracted: "no",
      hasRows: "yes",
      sortBy: "estimatedRowCount",
      sortDir: "desc",
    });
    expect(parsed.page).toBe(1);
    expect(parsed.sortBy).toBe("estimatedRowCount");
    expect(parsed.sortDir).toBe("desc");
    expect(parsed.extracted).toBe("no");
  });

  test("rejects an unknown sort field", () => {
    expect(listDiscoveredObjectsQuerySchema.safeParse({ sortBy: "password" }).success).toBe(false);
  });
});
