import { describe, expect, test } from "bun:test";
import type { CatalogObject, DiscoveryProgressHooks, ObjectDefinition } from "@migrator/oracle";
import { runDiscovery } from "./discovery.runner";

describe("runDiscovery", () => {
  test("upserts catalog objects and records success", async () => {
    const objects: CatalogObject[] = [
      {
        owner: "CLV",
        name: "ORDERS",
        objectType: "TABLE",
        lastDdlTime: new Date("2026-01-01T00:00:00Z"),
        estimatedRowCount: 10,
        byteSize: 8192,
        metadata: { columns: [] },
      },
    ];
    const definitions = new Map<string, ObjectDefinition>([
      [
        "CLV.ORDERS.TABLE",
        {
          source: "CREATE TABLE ORDERS (ID NUMBER)",
          hash: "abc",
          error: null,
          skipped: false,
        },
      ],
    ]);
    const upserts: unknown[] = [];
    const runUpdates: unknown[] = [];
    const audits: unknown[] = [];

    await runDiscovery({
      projectId: "p1",
      runId: "r1",
      schemas: ["CLV"],
      client: {
        async discoverInventory(
          _schemas: string[],
          _existing: unknown,
          hooks?: DiscoveryProgressHooks,
        ) {
          await hooks?.onCatalog?.(objects);
          const definition = definitions.get("CLV.ORDERS.TABLE");
          if (definition && objects[0]) {
            await hooks?.onDefinition?.({
              object: objects[0],
              definition,
              done: 1,
              total: 1,
            });
          }
          await hooks?.onDependencies?.();
          return {
            objects,
            definitions,
            dependencies: [
              {
                owner: "CLV",
                name: "ORDERS",
                objectType: "TABLE",
                referencedOwner: "CLV",
                referencedName: "ORDERS",
                referencedType: "TABLE",
                dependencyType: "HARD",
              },
            ],
          };
        },
      } as never,
      runs: {
        async update(_id: string, input: unknown) {
          runUpdates.push(input);
          return input;
        },
      } as never,
      objects: {
        async listByNaturalKeys() {
          if (upserts.length === 0) {
            return new Map();
          }
          return new Map([
            ["CLV.ORDERS.TABLE", { id: "o1", owner: "CLV", name: "ORDERS", objectType: "TABLE" }],
          ]);
        },
        async upsert(input: unknown) {
          upserts.push(input);
          return { id: "o1" };
        },
        async deleteUnseen() {
          return undefined;
        },
      } as never,
      dependencies: {
        async replaceForRun(_projectId: string, _runId: string, edges: unknown[]) {
          expect(edges).toEqual([]);
        },
      } as never,
      audit: {
        async append(input: unknown) {
          audits.push(input);
        },
      } as never,
    });

    expect(upserts.length).toBeGreaterThanOrEqual(1);
    expect(
      upserts.some((row) =>
        String((row as { sourceText?: string }).sourceText ?? "").includes("CREATE TABLE"),
      ),
    ).toBe(true);
    expect(
      runUpdates.some(
        (update) => (update as { stats?: { phase?: string } }).stats?.phase === "catalog",
      ),
    ).toBe(true);
    expect(
      runUpdates.some(
        (update) => (update as { stats?: { phase?: string } }).stats?.phase === "extracting_ddl",
      ),
    ).toBe(true);
    expect(
      runUpdates.some((update) => (update as { status?: string }).status === "SUCCEEDED"),
    ).toBe(true);
    expect(
      audits.some((item) => (item as { action: string }).action === "discovery.completed"),
    ).toBe(true);
  });

  test("records unique edges between distinct objects", async () => {
    const objects: CatalogObject[] = [
      {
        owner: "CLV",
        name: "ORDERS",
        objectType: "TABLE",
        lastDdlTime: null,
        estimatedRowCount: null,
        byteSize: null,
        metadata: {},
      },
      {
        owner: "CLV",
        name: "V_ORDERS",
        objectType: "VIEW",
        lastDdlTime: null,
        estimatedRowCount: null,
        byteSize: null,
        metadata: {},
      },
    ];
    const captured: unknown[] = [];

    await runDiscovery({
      projectId: "p1",
      runId: "r1",
      schemas: ["CLV"],
      client: {
        async discoverInventory(
          _schemas: string[],
          _existing: unknown,
          hooks?: DiscoveryProgressHooks,
        ) {
          await hooks?.onCatalog?.(objects);
          return {
            objects,
            definitions: new Map(),
            dependencies: [
              {
                owner: "CLV",
                name: "V_ORDERS",
                objectType: "VIEW",
                referencedOwner: "CLV",
                referencedName: "ORDERS",
                referencedType: "TABLE",
                dependencyType: "HARD",
              },
              {
                owner: "CLV",
                name: "V_ORDERS",
                objectType: "VIEW",
                referencedOwner: "CLV",
                referencedName: "ORDERS",
                referencedType: "TABLE",
                dependencyType: "HARD",
              },
            ],
          };
        },
      } as never,
      runs: {
        async update(_id: string, input: unknown) {
          return input;
        },
      } as never,
      objects: {
        async listByNaturalKeys() {
          return new Map([
            ["CLV.ORDERS.TABLE", { id: "o1", owner: "CLV", name: "ORDERS", objectType: "TABLE" }],
            ["CLV.V_ORDERS.VIEW", { id: "o2", owner: "CLV", name: "V_ORDERS", objectType: "VIEW" }],
          ]);
        },
        async upsert() {
          return { id: "o1" };
        },
        async deleteUnseen() {
          return undefined;
        },
      } as never,
      dependencies: {
        async replaceForRun(_projectId: string, _runId: string, edges: unknown[]) {
          captured.push(edges);
        },
      } as never,
      audit: {
        async append() {
          return undefined;
        },
      } as never,
    });

    expect(captured).toEqual([[{ fromObjectId: "o2", toObjectId: "o1", dependencyType: "HARD" }]]);
  });

  test("stores a short metadata-database error instead of a Failed query dump", async () => {
    const drizzleError = Object.assign(
      new Error("Failed query: insert into object_dependencies ..."),
      {
        cause: new Error("bind message has 83040 parameter formats"),
      },
    );
    const runUpdates: unknown[] = [];

    await expect(
      runDiscovery({
        projectId: "p1",
        runId: "r1",
        schemas: ["CLV"],
        client: {
          async discoverInventory() {
            throw drizzleError;
          },
        } as never,
        runs: {
          async update(_id: string, input: unknown) {
            runUpdates.push(input);
            return input;
          },
        } as never,
        objects: {
          async listByNaturalKeys() {
            return new Map();
          },
        } as never,
        dependencies: {} as never,
        audit: {
          async append() {
            return undefined;
          },
        } as never,
      }),
    ).rejects.toBe(drizzleError);

    expect(
      runUpdates.some(
        (update) =>
          (update as { errorMessage?: string }).errorMessage ===
          "bind message has 83040 parameter formats",
      ),
    ).toBe(true);
  });
});
