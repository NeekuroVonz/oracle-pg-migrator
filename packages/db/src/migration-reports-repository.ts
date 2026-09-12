import { eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type MigrationReportRow, migrationReports, type NewMigrationReportRow } from "./schema";

export class MigrationReportsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async getByRunId(runId: string): Promise<MigrationReportRow | undefined> {
    const [row] = await this.db
      .select()
      .from(migrationReports)
      .where(eq(migrationReports.runId, runId))
      .limit(1);
    return row;
  }

  async upsert(
    input: Pick<
      NewMigrationReportRow,
      "projectId" | "runId" | "gateStatus" | "readinessPercent" | "payload"
    >,
  ): Promise<MigrationReportRow> {
    const existing = await this.getByRunId(input.runId);
    if (existing) {
      const [row] = await this.db
        .update(migrationReports)
        .set({
          gateStatus: input.gateStatus,
          readinessPercent: input.readinessPercent,
          payload: input.payload,
          updatedAt: new Date(),
        })
        .where(eq(migrationReports.id, existing.id))
        .returning();
      if (!row) {
        throw new Error("failed to update migration report");
      }
      return row;
    }
    const [row] = await this.db.insert(migrationReports).values(input).returning();
    if (!row) {
      throw new Error("failed to insert migration report");
    }
    return row;
  }
}
