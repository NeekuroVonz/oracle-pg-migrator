/// <reference path="./oracledb.d.ts" />
import oracledb, { type Connection } from "oracledb";
import type { OracleConnectConfig, OracleDriver, OracleQueryResult, OracleSession } from "./types";

// Avoid cyclic Lob objects that break JSON.stringify and node-postgres binds.
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

class NodeOracleSession implements OracleSession {
  constructor(private readonly connection: Connection) {}

  async execute(
    sql: string,
    binds: unknown[] | Record<string, unknown> = [],
    options: Record<string, unknown> = {},
  ): Promise<OracleQueryResult> {
    const result = await this.connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      ...options,
    });
    return {
      rows: (result.rows as unknown[][] | undefined) ?? [],
      metaData: result.metaData?.map((column: { name: string }) => ({ name: column.name })),
    };
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}

export class NodeOracleDriver implements OracleDriver {
  async getConnection(config: OracleConnectConfig): Promise<OracleSession> {
    const connection = await oracledb.getConnection({
      user: config.user,
      password: config.password,
      connectString: config.connectString,
      connectTimeout: Math.ceil(config.connectTimeoutMs / 1000),
    });
    return new NodeOracleSession(connection);
  }
}
