import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));

export async function migrateMetadata(databaseUrl: string): Promise<void> {
  const drizzleDir = join(here, "..", "drizzle");
  const files = (await readdir(drizzleDir)).filter((file) => file.endsWith(".sql")).sort();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const file of files) {
      const sql = await readFile(join(drizzleDir, file), "utf8");
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (import.meta.main) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  await migrateMetadata(databaseUrl);
  console.log("metadata migrations applied");
}
