import { describe, expect, test } from "bun:test";
import { AesGcmSecretCipher } from "@migrator/config";
import { SOURCE_ORACLE_ACCESS } from "@migrator/shared";
import { ConnectionsService } from "./connections.service";

describe("ConnectionsService source safety", () => {
  test("source Oracle connections are hardcoded read-only", async () => {
    const created: Record<string, unknown>[] = [];
    const service = new ConnectionsService(
      {
        getByIdOrThrow: async () => ({
          id: "p1",
          name: "CLV",
          description: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as never,
      {
        create: async (input: Record<string, unknown>) => {
          created.push(input);
          return {
            ...input,
            id: "c1",
            lastTestedAt: null,
            lastTestStatus: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            oracleSid: input.oracleSid ?? null,
            oracleServiceName: input.oracleServiceName ?? null,
            oracleTns: input.oracleTns ?? null,
            oracleVersionOverride: input.oracleVersionOverride ?? null,
            host: input.host ?? null,
            port: input.port ?? null,
            databaseName: null,
            schemaName: null,
            sslMode: null,
            postgresVersion: null,
          };
        },
      } as never,
      {
        append: async () => undefined,
      } as never,
      new AesGcmSecretCipher("ab".repeat(32)),
    );

    const dto = await service.createOracle("p1", {
      displayName: "CLV Oracle",
      host: "10.0.0.8",
      port: 1521,
      connectType: "SERVICE_NAME",
      serviceName: "CLV",
      username: "migrator_ro",
      password: "super-secret",
      schemas: ["CLV"],
      connectionTimeoutMs: 15000,
    });

    expect(created[0]?.accessMode).toBe(SOURCE_ORACLE_ACCESS.accessMode);
    expect(created[0]?.allowWrite).toBe(false);
    expect(created[0]?.engine).toBe("ORACLE");
    expect(created[0]?.role).toBe("SOURCE");
    expect(dto.hasPassword).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("super-secret");
    expect(String(created[0]?.passwordCiphertext)).not.toBe("super-secret");
    expect(String(created[0]?.passwordCiphertext).startsWith("v1:")).toBe(true);
  });
});
