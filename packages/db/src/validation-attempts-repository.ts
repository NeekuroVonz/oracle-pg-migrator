import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import {
  type NewValidationAttemptRow,
  type ValidationAttemptRow,
  validationAttempts,
} from "./schema";

export class ValidationAttemptsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async append(
    input: Omit<NewValidationAttemptRow, "id" | "createdAt">,
  ): Promise<ValidationAttemptRow> {
    const [row] = await this.db.insert(validationAttempts).values(input).returning();
    if (!row) {
      throw new Error("failed to insert validation attempt");
    }
    return row;
  }

  async listByRun(runId: string): Promise<ValidationAttemptRow[]> {
    return this.db
      .select()
      .from(validationAttempts)
      .where(eq(validationAttempts.runId, runId))
      .orderBy(desc(validationAttempts.createdAt));
  }

  async listByRunObject(runId: string, objectId: string): Promise<ValidationAttemptRow[]> {
    const rows = await this.listByRun(runId);
    return rows.filter((row) => row.objectId === objectId);
  }

  async nextAttemptNumber(runId: string, objectId: string): Promise<number> {
    const rows = await this.listByRunObject(runId, objectId);
    return rows.length + 1;
  }
}
