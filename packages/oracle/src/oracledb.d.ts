declare module "oracledb" {
  export const OUT_FORMAT_ARRAY: number;
  export const CLOB: number;
  export const BLOB: number;

  export interface Metadata {
    name: string;
  }

  export interface Result {
    rows?: unknown[];
    metaData?: Metadata[];
  }

  export interface Connection {
    execute(
      sql: string,
      binds?: unknown[] | Record<string, unknown>,
      options?: Record<string, unknown>,
    ): Promise<Result>;
    close(): Promise<void>;
  }

  export interface ConnectionAttributes {
    user: string;
    password: string;
    connectString: string;
    connectTimeout?: number;
  }

  export function getConnection(attrs: ConnectionAttributes): Promise<Connection>;

  const oracledb: {
    OUT_FORMAT_ARRAY: number;
    CLOB: number;
    BLOB: number;
    fetchAsString: number[];
    fetchAsBuffer: number[];
    getConnection(attrs: ConnectionAttributes): Promise<Connection>;
  };

  export default oracledb;
}
