import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type MetadataDatabase = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export function createDatabase(pool: Pool): MetadataDatabase {
  return drizzle(pool, { schema });
}

export async function pingDatabase(pool: Pool): Promise<boolean> {
  const result = await pool.query("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}
