import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DeployRunRow, deployRuns, type NewDeployRunRow } from "./schema";

export class DeployRunsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async create(
    input: Pick<
      NewDeployRunRow,
      "projectId" | "conversionRunId" | "status" | "gateStatus" | "objectCount"
    >,
  ): Promise<DeployRunRow> {
    const [row] = await this.db.insert(deployRuns).values(input).returning();
    if (!row) {
      throw new Error("failed to insert deploy run");
    }
    return row;
  }

  async getById(id: string): Promise<DeployRunRow | undefined> {
    const [row] = await this.db.select().from(deployRuns).where(eq(deployRuns.id, id)).limit(1);
    return row;
  }

  async listByConversionRun(conversionRunId: string): Promise<DeployRunRow[]> {
    return this.db
      .select()
      .from(deployRuns)
      .where(eq(deployRuns.conversionRunId, conversionRunId))
      .orderBy(desc(deployRuns.createdAt));
  }

  async getLatestForConversionRun(conversionRunId: string): Promise<DeployRunRow | undefined> {
    const [row] = await this.listByConversionRun(conversionRunId);
    return row;
  }

  async findActiveByConversionRun(conversionRunId: string): Promise<DeployRunRow | undefined> {
    const rows = await this.listByConversionRun(conversionRunId);
    return rows.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        NewDeployRunRow,
        | "status"
        | "objectCount"
        | "deployedCount"
        | "failedCount"
        | "errorMessage"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<DeployRunRow> {
    const [row] = await this.db
      .update(deployRuns)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(deployRuns.id, id))
      .returning();
    if (!row) {
      throw new Error("deploy run not found");
    }
    return row;
  }
}
