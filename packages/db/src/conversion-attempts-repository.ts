import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import {
  type ConversionAttemptRow,
  conversionAttempts,
  type NewConversionAttemptRow,
} from "./schema";

export class ConversionAttemptsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async append(
    input: Omit<NewConversionAttemptRow, "id" | "createdAt">,
  ): Promise<ConversionAttemptRow> {
    const [row] = await this.db.insert(conversionAttempts).values(input).returning();
    if (!row) {
      throw new Error("failed to insert conversion attempt");
    }
    return row;
  }

  async listByRun(runId: string): Promise<ConversionAttemptRow[]> {
    return this.db
      .select()
      .from(conversionAttempts)
      .where(eq(conversionAttempts.runId, runId))
      .orderBy(desc(conversionAttempts.createdAt));
  }

  async listByRunObject(runId: string, objectId: string): Promise<ConversionAttemptRow[]> {
    return this.db
      .select()
      .from(conversionAttempts)
      .where(eq(conversionAttempts.runId, runId))
      .orderBy(desc(conversionAttempts.createdAt))
      .then((rows) => rows.filter((row) => row.objectId === objectId));
  }

  async nextAttemptNumber(runId: string, objectId: string): Promise<number> {
    const rows = await this.listByRunObject(runId, objectId);
    return rows.length + 1;
  }

  async countByConverter(
    runId: string,
    objectId: string,
    converterType: NewConversionAttemptRow["converterType"],
  ): Promise<number> {
    const rows = await this.listByRunObject(runId, objectId);
    return rows.filter((row) => row.converterType === converterType).length;
  }
}
