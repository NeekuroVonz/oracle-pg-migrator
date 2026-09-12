export interface OracleConnectConfig {
  user: string;
  password: string;
  connectString: string;
  connectTimeoutMs: number;
}

export interface OracleQueryResult {
  rows: unknown[][];
  metaData?: Array<{ name: string }>;
}

export interface OracleSession {
  execute(
    sql: string,
    binds?: unknown[] | Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<OracleQueryResult>;
  close(): Promise<void>;
}

export interface OracleDriver {
  getConnection(config: OracleConnectConfig): Promise<OracleSession>;
}

export interface OracleSourceConfig {
  displayName: string;
  host?: string;
  port: number;
  connectType: "SID" | "SERVICE_NAME" | "TNS";
  sid?: string;
  serviceName?: string;
  tns?: string;
  username: string;
  password: string;
  schemas: string[];
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
}

export function buildOracleConnectString(config: OracleSourceConfig): string {
  switch (config.connectType) {
    case "TNS":
      if (!config.tns) {
        throw new Error("tns is required");
      }
      return config.tns;
    case "SID":
      if (!config.host || !config.sid) {
        throw new Error("host and sid are required");
      }
      return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))(CONNECT_DATA=(SID=${config.sid})))`;
    case "SERVICE_NAME":
      if (!config.host || !config.serviceName) {
        throw new Error("host and serviceName are required");
      }
      return `${config.host}:${config.port}/${config.serviceName}`;
    default: {
      const exhaustive: never = config.connectType;
      throw new Error(`unsupported connect type: ${String(exhaustive)}`);
    }
  }
}
