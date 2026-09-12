import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { DatabaseValidatorPool, inspectValidatorPool } from "./pool";

const TEST_URL =
  process.env.VALIDATOR_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://migrator:migrator@127.0.0.1:5433/migrator";

describe("inspectValidatorPool", () => {
  test("never returns a password", async () => {
    const status = await inspectValidatorPool({
      mode: "database",
      size: 2,
      databaseUrl: "postgres://validator:s3cret-password@localhost:5434/validator",
      dockerImage: "postgres:16-alpine",
      statementTimeoutMs: 5000,
    });
    expect(JSON.stringify(status)).not.toContain("s3cret-password");
    expect(status.host).toBe("localhost");
    expect(status.port).toBe(5434);
  });
});

describe("DatabaseValidatorPool", () => {
  test("reuses isolated databases instead of creating one per object", async () => {
    const pool = new DatabaseValidatorPool({
      mode: "database",
      size: 1,
      databaseUrl: TEST_URL,
      dockerImage: "postgres:16-alpine",
      statementTimeoutMs: 5000,
    });
    try {
      const healthy = await pool.ping();
      if (!healthy) {
        return;
      }
      const first = await pool.acquire();
      expect(first.database).toBe("validator_slot_1");
      expect(first.connectionString.includes("://")).toBe(true);
      const statusBusy = await pool.status();
      expect(statusBusy.busy).toBe(1);
      expect(statusBusy.available).toBe(0);
      expect(JSON.stringify(statusBusy)).not.toMatch(/:[^:@/]+@/);
      await pool.release(first);
      const second = await pool.acquire();
      expect(second.database).toBe(first.database);
      await pool.release(second);
      const idle = await pool.status();
      expect(idle.available).toBe(1);
      expect(idle.message).toContain("reused");
    } finally {
      await pool.close();
    }
  });

  test("resets leftover non-public schemas so CREATE TABLE does not fail already exists", async () => {
    const pool = new DatabaseValidatorPool({
      mode: "database",
      size: 1,
      databaseUrl: TEST_URL,
      dockerImage: "postgres:16-alpine",
      statementTimeoutMs: 5000,
    });
    try {
      const healthy = await pool.ping();
      if (!healthy) {
        return;
      }
      const slot = await pool.acquire();
      const client = new Client({
        connectionString: slot.connectionString,
        connectionTimeoutMillis: 5000,
      });
      await client.connect();
      await client.query("CREATE SCHEMA wms1; CREATE TABLE wms1.tco_buspartner (pk int);");
      await client.end();
      await pool.release(slot);
      const again = await pool.acquire();
      const check = new Client({
        connectionString: again.connectionString,
        connectionTimeoutMillis: 5000,
      });
      await check.connect();
      const leftover = await check.query("SELECT nspname FROM pg_namespace WHERE nspname = 'wms1'");
      expect(leftover.rows).toEqual([]);
      await check.end();
      await pool.release(again);
    } finally {
      await pool.close();
    }
  });
});
