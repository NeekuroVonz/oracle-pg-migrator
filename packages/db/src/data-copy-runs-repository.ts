import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DataCopyRunRow, dataCopyRuns, type NewDataCopyRunRow } from "./schema";

export class DataCopyRunsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async create(
    input: Pick<
      NewDataCopyRunRow,
      "projectId" | "conversionRunId" | "status" | "dataMode" | "chunkSize" | "tableCount"
    >,
  ): Promise<DataCopyRunRow> {
    const [row] = await this.db.insert(dataCopyRuns).values(input).returning();
    if (!row) {
      throw new Error("failed to insert data copy run");
    }
    return row;
  }

  async getById(id: string): Promise<DataCopyRunRow | undefined> {
    const [row] = await this.db.select().from(dataCopyRuns).where(eq(dataCopyRuns.id, id)).limit(1);
    return row;
  }

  async listByConversionRun(conversionRunId: string): Promise<DataCopyRunRow[]> {
    return this.db
      .select()
      .from(dataCopyRuns)
      .where(eq(dataCopyRuns.conversionRunId, conversionRunId))
      .orderBy(desc(dataCopyRuns.createdAt));
  }

  async getLatestForConversionRun(conversionRunId: string): Promise<DataCopyRunRow | undefined> {
    const [row] = await this.listByConversionRun(conversionRunId);
    return row;
  }

  async findActiveByConversionRun(conversionRunId: string): Promise<DataCopyRunRow | undefined> {
    const rows = await this.listByConversionRun(conversionRunId);
    return rows.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        NewDataCopyRunRow,
        | "status"
        | "tableCount"
        | "copiedCount"
        | "failedCount"
        | "matchedCount"
        | "errorMessage"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<DataCopyRunRow> {
    const [row] = await this.db
      .update(dataCopyRuns)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(dataCopyRuns.id, id))
      .returning();
    if (!row) {
      throw new Error("data copy run not found");
    }
    return row;
  }
}
