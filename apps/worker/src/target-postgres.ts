import type { SecretCipher } from "@migrator/config";
import type { ConnectionsRepository } from "@migrator/db";
import { createPostgresClient, postgresConfigFromConnection } from "@migrator/postgres";
import type { Client } from "pg";

export async function connectProjectTarget(input: {
  projectId: string;
  connections: ConnectionsRepository;
  cipher: SecretCipher;
  statementTimeoutMs: number;
}): Promise<Client> {
  const target = await input.connections.getByProjectRole(input.projectId, "TARGET");
  if (target?.engine !== "POSTGRESQL") {
    throw new Error("PostgreSQL target connection is required");
  }
  const password = input.cipher.decrypt(target.passwordCiphertext);
  const client = createPostgresClient(
    postgresConfigFromConnection({
      host: target.host,
      port: target.port,
      databaseName: target.databaseName,
      username: target.username,
      password,
      sslMode: target.sslMode,
      connectionTimeoutMs: target.connectionTimeoutMs,
    }),
    input.statementTimeoutMs,
  );
  await client.connect();
  return client;
}
