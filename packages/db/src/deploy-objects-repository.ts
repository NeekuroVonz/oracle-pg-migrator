import { eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DeployObjectRow, deployObjects, type NewDeployObjectRow } from "./schema";

export class DeployObjectsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async replace(
    deployRunId: string,
    items: Array<
      Pick<
        NewDeployObjectRow,
        | "objectId"
        | "owner"
        | "name"
        | "objectType"
        | "targetSchema"
        | "targetName"
        | "sortIndex"
        | "sql"
        | "status"
      >
    >,
  ): Promise<DeployObjectRow[]> {
    await this.db.delete(deployObjects).where(eq(deployObjects.deployRunId, deployRunId));
    if (items.length === 0) {
      return [];
    }
    return this.db
      .insert(deployObjects)
      .values(items.map((item) => ({ ...item, deployRunId })))
      .returning();
  }

  async listByDeployRun(deployRunId: string): Promise<DeployObjectRow[]> {
    return this.db
      .select()
      .from(deployObjects)
      .where(eq(deployObjects.deployRunId, deployRunId))
      .orderBy(deployObjects.sortIndex, deployObjects.owner, deployObjects.name);
  }

  async update(
    id: string,
    input: Partial<Pick<NewDeployObjectRow, "status" | "errorMessage">>,
  ): Promise<DeployObjectRow> {
    const [row] = await this.db
      .update(deployObjects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(deployObjects.id, id))
      .returning();
    if (!row) {
      throw new Error("deploy object not found");
    }
    return row;
  }
}
