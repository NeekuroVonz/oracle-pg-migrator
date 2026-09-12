import { and, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import type { DiscoveredObjectRow } from "./schema";
import { discoveredObjects, migrationRunObjects } from "./schema";

export class MigrationRunObjectsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async replace(
    runId: string,
    items: Array<{ objectId: string; deferred: boolean }>,
  ): Promise<void> {
    await this.db.delete(migrationRunObjects).where(eq(migrationRunObjects.runId, runId));
    if (items.length === 0) {
      return;
    }
    await this.db.insert(migrationRunObjects).values(
      items.map((item) => ({
        runId,
        objectId: item.objectId,
        deferred: item.deferred,
      })),
    );
  }

  async listObjects(runId: string): Promise<Array<DiscoveredObjectRow & { deferred: boolean }>> {
    const rows = await this.db
      .select({
        object: discoveredObjects,
        deferred: migrationRunObjects.deferred,
      })
      .from(migrationRunObjects)
      .innerJoin(discoveredObjects, eq(discoveredObjects.id, migrationRunObjects.objectId))
      .where(eq(migrationRunObjects.runId, runId))
      .orderBy(discoveredObjects.owner, discoveredObjects.objectType, discoveredObjects.name);
    return rows.map((row) => ({ ...row.object, deferred: row.deferred }));
  }

  async getObject(
    runId: string,
    objectId: string,
  ): Promise<(DiscoveredObjectRow & { deferred: boolean }) | undefined> {
    const [row] = await this.db
      .select({
        object: discoveredObjects,
        deferred: migrationRunObjects.deferred,
      })
      .from(migrationRunObjects)
      .innerJoin(discoveredObjects, eq(discoveredObjects.id, migrationRunObjects.objectId))
      .where(and(eq(migrationRunObjects.runId, runId), eq(migrationRunObjects.objectId, objectId)))
      .limit(1);
    return row ? { ...row.object, deferred: row.deferred } : undefined;
  }
}
