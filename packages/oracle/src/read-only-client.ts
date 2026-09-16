import {
  type ConnectionTestResult,
  type OraclePrivilegeStatus,
  WRITE_PRIVILEGE_WARNING,
} from "@migrator/shared";
import {
  type CatalogDependency,
  type CatalogObject,
  type CatalogSelect,
  collectCatalog,
  collectDependencies,
  extractBatchedDdl,
  extractDefinition,
  GET_DDL_BATCH_SIZE,
  type ObjectDefinition,
} from "./catalog";
import { CATALOG_SQL } from "./catalog-sql";
import { NodeOracleDriver } from "./node-oracle-driver";
import { normalizeOracleRows } from "./normalize-rows";
import { ddlDictionaryType, SYSTEM_ORACLE_SCHEMAS } from "./object-types";
import { isMissingOracleDictionary, wrapOracleQueryError } from "./oracle-errors";
import { assertOracleSelect } from "./sql-classifier";
import { buildTableChunkSql, buildTableCountSql } from "./table-chunk";
import {
  buildOracleConnectString,
  type OracleDriver,
  type OracleSession,
  type OracleSourceConfig,
} from "./types";

export interface DiscoveryProgressHooks {
  onCatalog?: (objects: CatalogObject[]) => Promise<void> | void;
  onDefinition?: (event: {
    object: CatalogObject;
    definition: ObjectDefinition;
    done: number;
    total: number;
  }) => Promise<void> | void;
  onDependencies?: () => Promise<void> | void;
}

const DDL_EXTRACT_CONCURRENCY = 8;

function sameDdlTime(left: Date | null | undefined, right: Date | null | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  return left.getTime() === right.getTime();
}

const WRITE_PRIVILEGE_MARKERS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "ALTER",
  "DROP",
  "GRANT",
  "BECOME",
  "UNLIMITED TABLESPACE",
];

function isWritePrivilege(privilege: string): boolean {
  const upper = privilege.toUpperCase();
  if (upper === "CREATE SESSION") {
    return false;
  }
  if (upper.startsWith("CREATE ") || upper.startsWith("ALTER ") || upper.startsWith("DROP ")) {
    return true;
  }
  if (upper.startsWith("INSERT") || upper.startsWith("UPDATE") || upper.startsWith("DELETE")) {
    return true;
  }
  return WRITE_PRIVILEGE_MARKERS.some((marker) => upper.includes(marker));
}

export class OracleReadOnlyClient {
  readonly accessMode = "READ_ONLY" as const;
  readonly allowWrite = false as const;
  readonly engine = "ORACLE" as const;

  constructor(
    private readonly config: OracleSourceConfig,
    private readonly driver: OracleDriver = new NodeOracleDriver(),
  ) {}

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const session = await this.openSession();
      try {
        const userResult = await this.select(session, CATALOG_SQL.sessionUser);
        const user = String(userResult[0]?.[0] ?? this.config.username);
        let serverVersion: string | null = null;
        try {
          const versionResult = await this.select(session, CATALOG_SQL.version);
          serverVersion = versionResult[0]?.[0] ? String(versionResult[0][0]) : null;
        } catch {
          serverVersion = null;
        }
        const privilegeStatus = await this.readPrivilegeStatus(session);
        return {
          ok: true,
          engine: "ORACLE",
          accessMode: "READ_ONLY",
          serverVersion: serverVersion ?? `connected as ${user}`,
          latencyMs: Date.now() - started,
          message:
            "Source Oracle 🔒 READ ONLY. This migration service never modifies the Oracle source database.",
          privilegeStatus,
        };
      } finally {
        await session.close();
      }
    } catch (error) {
      return {
        ok: false,
        engine: "ORACLE",
        accessMode: "READ_ONLY",
        serverVersion: null,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Oracle connection failed",
      };
    }
  }

  async getSessionUser(): Promise<string> {
    const { sessionUser } = await this.listSchemaCatalog();
    return sessionUser;
  }

  async getSchemas(): Promise<string[]> {
    const { schemas } = await this.listSchemaCatalog();
    return schemas;
  }

  async listSchemaCatalog(): Promise<{ sessionUser: string; schemas: string[] }> {
    return this.withSession(async (session) => {
      const userRows = await this.select(session, CATALOG_SQL.sessionUser);
      const sessionUser = String(userRows[0]?.[0] ?? this.config.username).toUpperCase();
      const names = new Set<string>();
      if (sessionUser) {
        names.add(sessionUser);
      }
      for (const sql of [CATALOG_SQL.objectOwners, CATALOG_SQL.schemas]) {
        try {
          const rows = await this.select(session, sql);
          for (const row of rows) {
            const name = String(row[0] ?? "").toUpperCase();
            if (name) {
              names.add(name);
            }
          }
        } catch (error) {
          if (!isMissingOracleDictionary(error)) {
            throw error;
          }
        }
      }
      const schemas = [...names]
        .filter((name) => name.length > 0)
        .filter((name) => !SYSTEM_ORACLE_SCHEMAS.has(name))
        .sort();
      return { sessionUser, schemas };
    });
  }

  async discoverObjects(schemas: string[]): Promise<CatalogObject[]> {
    return this.withSession(async (session) =>
      collectCatalog((sql, binds) => this.select(session, sql, binds), schemas),
    );
  }

  async getObjectDefinition(object: {
    owner: string;
    name: string;
    objectType: CatalogObject["objectType"];
  }): Promise<ObjectDefinition> {
    return this.withSession(async (session) =>
      extractDefinition((sql, binds) => this.select(session, sql, binds), object),
    );
  }

  async getDependencies(schemas: string[]): Promise<CatalogDependency[]> {
    return this.withSession(async (session) =>
      collectDependencies((sql, binds) => this.select(session, sql, binds), schemas),
    );
  }

  async discoverInventory(
    schemas: string[],
    existing: Map<string, { lastDdlTime: Date | null; sourceHash: string | null }> = new Map(),
    hooks?: DiscoveryProgressHooks,
  ): Promise<{
    objects: CatalogObject[];
    definitions: Map<string, ObjectDefinition>;
    dependencies: CatalogDependency[];
  }> {
    const session = await this.openSession();
    const extraSessions: OracleSession[] = [];
    try {
      const select = (sql: string, binds?: Record<string, string>) =>
        this.select(session, sql, binds);
      const objects = await collectCatalog(select, schemas);
      await hooks?.onCatalog?.(objects);

      const definitions = new Map<string, ObjectDefinition>();
      const pending: CatalogObject[] = [];
      let completed = 0;
      const total = objects.length;

      for (const object of objects) {
        const key = `${object.owner}.${object.name}.${object.objectType}`;
        const prior = existing.get(key);
        if (prior?.sourceHash && sameDdlTime(prior.lastDdlTime, object.lastDdlTime)) {
          const definition: ObjectDefinition = {
            source: null,
            hash: prior.sourceHash,
            error: null,
            skipped: true,
          };
          definitions.set(key, definition);
          completed += 1;
          await hooks?.onDefinition?.({ object, definition, done: completed, total });
          continue;
        }
        if (object.inlineDefinition) {
          definitions.set(key, object.inlineDefinition);
          completed += 1;
          await hooks?.onDefinition?.({
            object,
            definition: object.inlineDefinition,
            done: completed,
            total,
          });
          continue;
        }
        pending.push(object);
      }

      if (pending.length > 0) {
        const batchSelect: CatalogSelect = (sql, binds) =>
          this.select(
            session,
            sql,
            binds,
            Math.min(120_000, Math.max(this.config.statementTimeoutMs, 15_000) * 8),
          );
        const remaining: CatalogObject[] = [];
        const grouped = new Map<string, CatalogObject[]>();
        for (const object of pending) {
          const dictType = ddlDictionaryType(object.objectType);
          if (!dictType) {
            remaining.push(object);
            continue;
          }
          const groupKey = `${object.owner}\0${object.objectType}`;
          const list = grouped.get(groupKey) ?? [];
          list.push(object);
          grouped.set(groupKey, list);
        }
        for (const group of grouped.values()) {
          const owner = group[0]?.owner;
          const objectType = group[0]?.objectType;
          if (!owner || !objectType) {
            remaining.push(...group);
            continue;
          }
          for (let offset = 0; offset < group.length; offset += GET_DDL_BATCH_SIZE) {
            const chunk = group.slice(offset, offset + GET_DDL_BATCH_SIZE);
            try {
              const batched = await extractBatchedDdl(batchSelect, {
                owner,
                objectType,
                names: chunk.map((item) => item.name),
              });
              for (const object of chunk) {
                const definition = batched.get(object.name);
                if (!definition) {
                  remaining.push(object);
                  continue;
                }
                const key = `${object.owner}.${object.name}.${object.objectType}`;
                definitions.set(key, definition);
                completed += 1;
                await hooks?.onDefinition?.({ object, definition, done: completed, total });
              }
            } catch {
              remaining.push(...chunk);
            }
          }
        }

        if (remaining.length > 0) {
          const workerCount = Math.min(DDL_EXTRACT_CONCURRENCY, remaining.length);
          for (let index = 1; index < workerCount; index += 1) {
            extraSessions.push(await this.openSession());
          }
          const pool = [session, ...extraSessions];
          let next = 0;
          await Promise.all(
            pool.map(async (workerSession) => {
              const workerSelect = (sql: string, binds?: Record<string, string>) =>
                this.select(workerSession, sql, binds);
              while (true) {
                const index = next;
                next += 1;
                if (index >= remaining.length) {
                  return;
                }
                const object = remaining[index];
                if (!object) {
                  return;
                }
                const definition = await extractDefinition(workerSelect, object);
                definitions.set(`${object.owner}.${object.name}.${object.objectType}`, definition);
                completed += 1;
                await hooks?.onDefinition?.({
                  object,
                  definition,
                  done: completed,
                  total,
                });
              }
            }),
          );
        }
      }

      await hooks?.onDependencies?.();
      const dependencies = await collectDependencies(select, schemas);
      return { objects, definitions, dependencies };
    } finally {
      await Promise.all(extraSessions.map(async (extra) => extra.close()));
      await session.close();
    }
  }

  async executeValidationSelect(sql: string): Promise<unknown[][]> {
    const classification = assertOracleSelect(sql);
    return this.withSession(async (session) => {
      const result = await session.execute(classification.normalizedSql, [], {
        callTimeout: this.config.statementTimeoutMs,
      });
      return result.rows;
    });
  }

  async countTableRows(owner: string, name: string): Promise<number> {
    const sql = buildTableCountSql(owner, name);
    assertOracleSelect(sql);
    const rows = await this.withSession(async (session) => this.select(session, sql));
    return Number(rows[0]?.[0] ?? 0);
  }

  async readTableChunk(input: {
    owner: string;
    name: string;
    columns: string[];
    offset: number;
    limit: number;
  }): Promise<unknown[][]> {
    const sql = buildTableChunkSql(input);
    assertOracleSelect(sql);
    const rows = await this.withSession(async (session) => this.select(session, sql));
    return normalizeOracleRows(rows);
  }

  private async openSession(): Promise<OracleSession> {
    return this.driver.getConnection({
      user: this.config.username,
      password: this.config.password,
      connectString: buildOracleConnectString(this.config),
      connectTimeoutMs: this.config.connectionTimeoutMs,
    });
  }

  private async withSession<T>(fn: (session: OracleSession) => Promise<T>): Promise<T> {
    const session = await this.openSession();
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  private async select(
    session: OracleSession,
    sql: string,
    binds: Record<string, string> | unknown[] = [],
    timeoutMs = this.config.statementTimeoutMs,
  ): Promise<unknown[][]> {
    const classification = assertOracleSelect(sql);
    try {
      const result = await session.execute(classification.normalizedSql, binds, {
        callTimeout: timeoutMs,
      });
      return result.rows;
    } catch (error) {
      throw wrapOracleQueryError(sql, error);
    }
  }

  private async readPrivilegeStatus(session: OracleSession): Promise<OraclePrivilegeStatus> {
    try {
      const result = await this.select(session, CATALOG_SQL.privileges);
      const privileges = result.map((row) => String(row[0]));
      const writeDetected = privileges.some((privilege) => isWritePrivilege(privilege));
      const readPrivileges = privileges.some((privilege) => {
        const upper = privilege.toUpperCase();
        return upper.includes("SELECT") || upper === "CREATE SESSION";
      });
      return {
        readPrivileges: readPrivileges || privileges.length > 0,
        writePrivileges: writeDetected ? "DETECTED" : "NOT_DETECTED",
        privileges,
        warning: writeDetected ? WRITE_PRIVILEGE_WARNING : null,
      };
    } catch {
      return {
        readPrivileges: true,
        writePrivileges: "NOT_DETECTED",
        privileges: [],
        warning: null,
      };
    }
  }
}
