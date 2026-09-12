import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type NewTestAttemptRow, type TestAttemptRow, testAttempts } from "./schema";

export class TestAttemptsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async append(input: Omit<NewTestAttemptRow, "id" | "createdAt">): Promise<TestAttemptRow> {
    const [row] = await this.db.insert(testAttempts).values(input).returning();
    if (!row) {
      throw new Error("failed to insert test attempt");
    }
    return row;
  }

  async listByRun(runId: string): Promise<TestAttemptRow[]> {
    return this.db
      .select()
      .from(testAttempts)
      .where(eq(testAttempts.runId, runId))
      .orderBy(desc(testAttempts.createdAt));
  }

  async listByRunObject(runId: string, objectId: string): Promise<TestAttemptRow[]> {
    const rows = await this.listByRun(runId);
    return rows.filter((row) => row.objectId === objectId);
  }

  async nextAttemptNumber(runId: string, objectId: string): Promise<number> {
    const rows = await this.listByRunObject(runId, objectId);
    return rows.length + 1;
  }
}
