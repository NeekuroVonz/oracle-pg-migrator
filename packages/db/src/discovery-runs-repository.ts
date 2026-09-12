import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DiscoveryRunRow, discoveryRuns, type NewDiscoveryRunRow } from "./schema";

export class DiscoveryRunsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async create(
    input: Pick<NewDiscoveryRunRow, "projectId" | "connectionId" | "status" | "schemas">,
  ): Promise<DiscoveryRunRow> {
    const [row] = await this.db.insert(discoveryRuns).values(input).returning();
    if (!row) {
      throw new Error("failed to insert discovery run");
    }
    return row;
  }

  async getById(id: string): Promise<DiscoveryRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.id, id))
      .limit(1);
    return row;
  }

  async latestByProject(projectId: string): Promise<DiscoveryRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.projectId, projectId))
      .orderBy(desc(discoveryRuns.createdAt))
      .limit(1);
    return row;
  }

  async findActiveByProject(projectId: string): Promise<DiscoveryRunRow | undefined> {
    const rows = await this.db
      .select()
      .from(discoveryRuns)
      .where(eq(discoveryRuns.projectId, projectId))
      .orderBy(desc(discoveryRuns.createdAt));
    return rows.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        NewDiscoveryRunRow,
        | "status"
        | "objectCount"
        | "extractedCount"
        | "skippedUnchangedCount"
        | "stats"
        | "errorMessage"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<DiscoveryRunRow> {
    const [row] = await this.db
      .update(discoveryRuns)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(discoveryRuns.id, id))
      .returning();
    if (!row) {
      throw new Error("discovery run not found");
    }
    return row;
  }
}
