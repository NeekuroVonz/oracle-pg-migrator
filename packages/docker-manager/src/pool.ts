import { spawn } from "node:child_process";
import type { ValidatorMode, ValidatorPoolDto, ValidatorSlotStatus } from "@migrator/shared";
import { Client } from "pg";

export interface ValidatorPoolConfig {
  mode: ValidatorMode;
  size: number;
  databaseUrl?: string;
  dockerImage: string;
  statementTimeoutMs: number;
}

export interface ValidatorSlot {
  id: string;
  database: string;
  connectionString: string;
}

interface InternalSlot {
  id: string;
  database: string;
  connectionString: string;
  status: ValidatorSlotStatus;
  containerName?: string;
}

export interface ValidatorPool {
  status(): Promise<ValidatorPoolDto>;
  acquire(): Promise<ValidatorSlot>;
  release(slot: ValidatorSlot): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function redactedHost(url: string | undefined): { host: string | null; port: number | null } {
  if (!url) {
    return { host: null, port: null };
  }
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname || null, port: parsed.port ? Number(parsed.port) : 5432 };
  } catch {
    return { host: null, port: null };
  }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function maintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

async function queryUrl(url: string, sql: string, values: unknown[] = []): Promise<void> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query(sql, values);
  } finally {
    await client.end();
  }
}

async function resetDatabase(connectionString: string): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE
        schema_name text;
      BEGIN
        FOR schema_name IN
          SELECT nspname
          FROM pg_namespace
          WHERE nspname NOT LIKE 'pg_%'
            AND nspname <> 'information_schema'
        LOOP
          EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
        END LOOP;
        EXECUTE 'CREATE SCHEMA public';
        EXECUTE 'GRANT ALL ON SCHEMA public TO public';
      END
      $$;
    `);
  } finally {
    await client.end();
  }
}

function docker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export class DatabaseValidatorPool implements ValidatorPool {
  private readonly slots: InternalSlot[] = [];
  private waiters: Array<() => void> = [];
  private ready: Promise<void>;

  constructor(private readonly config: ValidatorPoolConfig) {
    if (!config.databaseUrl) {
      throw new Error("VALIDATOR_DATABASE_URL is required for database validator mode");
    }
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const url = this.config.databaseUrl;
    if (!url) {
      throw new Error("VALIDATOR_DATABASE_URL is required");
    }
    const admin = maintenanceUrl(url);
    for (let i = 1; i <= this.config.size; i += 1) {
      const database = `validator_slot_${i}`;
      try {
        await queryUrl(admin, `CREATE DATABASE ${database}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message)) {
          throw error;
        }
      }
      const connectionString = withDatabase(url, database);
      await resetDatabase(connectionString);
      this.slots.push({
        id: `slot-${i}`,
        database,
        connectionString,
        status: "idle",
      });
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ready;
      const url = this.config.databaseUrl;
      if (!url) {
        return false;
      }
      await queryUrl(url, "SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<ValidatorPoolDto> {
    try {
      await this.ready;
    } catch (error) {
      const { host, port } = redactedHost(this.config.databaseUrl);
      return {
        mode: "database",
        size: this.config.size,
        available: 0,
        busy: 0,
        healthy: false,
        host,
        port,
        message: error instanceof Error ? error.message : "Validator pool failed to start",
        slots: [],
      };
    }
    const { host, port } = redactedHost(this.config.databaseUrl);
    const available = this.slots.filter((slot) => slot.status === "idle").length;
    const busy = this.slots.filter((slot) => slot.status === "busy").length;
    return {
      mode: "database",
      size: this.slots.length,
      available,
      busy,
      healthy: true,
      host,
      port,
      message: `Pre-warmed pool of ${this.slots.length} PostgreSQL databases. Slots are reset and reused; objects do not get their own containers.`,
      slots: this.slots.map((slot) => ({
        id: slot.id,
        status: slot.status,
        database: slot.database,
      })),
    };
  }

  async acquire(): Promise<ValidatorSlot> {
    await this.ready;
    for (;;) {
      const free = this.slots.find((slot) => slot.status === "idle");
      if (free) {
        free.status = "busy";
        return {
          id: free.id,
          database: free.database,
          connectionString: free.connectionString,
        };
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  async release(slot: ValidatorSlot): Promise<void> {
    const internal = this.slots.find((item) => item.id === slot.id);
    if (!internal) {
      return;
    }
    try {
      await resetDatabase(internal.connectionString);
      internal.status = "idle";
    } catch {
      internal.status = "unhealthy";
    }
    const waiter = this.waiters.shift();
    waiter?.();
  }

  async close(): Promise<void> {
    this.waiters = [];
  }
}

export class DockerValidatorPool implements ValidatorPool {
  private readonly inner: DatabaseValidatorPool;
  private readonly containerNames: string[] = [];
  private bootstrap: Promise<void>;

  constructor(private readonly config: ValidatorPoolConfig) {
    if (!config.databaseUrl) {
      throw new Error(
        "VALIDATOR_DATABASE_URL is required even in docker mode for connection templates",
      );
    }
    this.inner = new DatabaseValidatorPool(config);
    this.bootstrap = this.ensureContainers();
  }

  private async ensureContainers(): Promise<void> {
    for (let i = 1; i <= this.config.size; i += 1) {
      const name = `migrator-validator-${i}`;
      this.containerNames.push(name);
      const inspect = await docker(["inspect", "-f", "{{.State.Running}}", name]).catch(() => ({
        code: 1,
        stdout: "",
        stderr: "missing",
      }));
      if (inspect.code === 0 && inspect.stdout.trim() === "true") {
        continue;
      }
      if (inspect.code === 0) {
        await docker(["start", name]);
        continue;
      }
      const result = await docker([
        "run",
        "-d",
        "--name",
        name,
        "-e",
        "POSTGRES_USER=validator",
        "-e",
        "POSTGRES_PASSWORD=validator",
        "-e",
        "POSTGRES_DB=validator",
        this.config.dockerImage,
      ]);
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || "docker run failed for validator pool");
      }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.bootstrap;
      return this.inner.ping();
    } catch {
      return false;
    }
  }

  async status(): Promise<ValidatorPoolDto> {
    try {
      await this.bootstrap;
      const status = await this.inner.status();
      return {
        ...status,
        mode: "docker",
        message: `Pre-warmed Docker pool (${this.containerNames.join(", ")}). Containers are reused across objects.`,
      };
    } catch (error) {
      const { host, port } = redactedHost(this.config.databaseUrl);
      return {
        mode: "docker",
        size: this.config.size,
        available: 0,
        busy: 0,
        healthy: false,
        host,
        port,
        message: error instanceof Error ? error.message : "Docker validator pool failed",
        slots: [],
      };
    }
  }

  acquire(): Promise<ValidatorSlot> {
    return this.inner.acquire();
  }

  release(slot: ValidatorSlot): Promise<void> {
    return this.inner.release(slot);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

export function createValidatorPool(config: ValidatorPoolConfig): ValidatorPool {
  if (config.mode === "docker") {
    return new DockerValidatorPool(config);
  }
  return new DatabaseValidatorPool(config);
}

export async function inspectValidatorPool(config: ValidatorPoolConfig): Promise<ValidatorPoolDto> {
  const { host, port } = redactedHost(config.databaseUrl);
  const slots = Array.from({ length: config.size }, (_, index) => ({
    id: `slot-${index + 1}`,
    status: "idle" as const,
    database: `validator_slot_${index + 1}`,
  }));
  if (!config.databaseUrl) {
    return {
      mode: config.mode,
      size: config.size,
      available: 0,
      busy: 0,
      healthy: false,
      host,
      port,
      message: "VALIDATOR_DATABASE_URL is not set",
      slots: [],
    };
  }
  try {
    await queryUrl(config.databaseUrl, "SELECT 1");
    return {
      mode: config.mode,
      size: config.size,
      available: config.size,
      busy: 0,
      healthy: true,
      host,
      port,
      message:
        config.mode === "docker"
          ? "Pre-warmed Docker validator pool. Containers/databases are reused; objects do not get their own containers."
          : "Pre-warmed PostgreSQL validator databases. Slots are reset and reused; objects do not get their own containers.",
      slots,
    };
  } catch (error) {
    return {
      mode: config.mode,
      size: config.size,
      available: 0,
      busy: 0,
      healthy: false,
      host,
      port,
      message: error instanceof Error ? error.message : "Validator PostgreSQL is unreachable",
      slots: [],
    };
  }
}
