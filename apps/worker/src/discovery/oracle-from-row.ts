import type { ConnectionRow } from "@migrator/db";
import { OracleReadOnlyClient, type OracleSourceConfig } from "@migrator/oracle";

export function oracleSourceConfigFromRow(
  row: ConnectionRow,
  password: string,
  statementTimeoutMs: number,
): OracleSourceConfig {
  return {
    displayName: row.displayName,
    host: row.host ?? undefined,
    port: row.port ?? 1521,
    connectType: row.oracleConnectType ?? "SERVICE_NAME",
    sid: row.oracleSid ?? undefined,
    serviceName: row.oracleServiceName ?? undefined,
    tns: row.oracleTns ?? undefined,
    username: row.username,
    password,
    schemas: row.oracleSchemas ?? [],
    connectionTimeoutMs: row.connectionTimeoutMs,
    statementTimeoutMs,
  };
}

export function oracleClientFromRow(
  row: ConnectionRow,
  password: string,
  statementTimeoutMs: number,
): OracleReadOnlyClient {
  return new OracleReadOnlyClient(oracleSourceConfigFromRow(row, password, statementTimeoutMs));
}
