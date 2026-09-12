import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type MigrationRunRow, migrationRuns, type NewMigrationRunRow } from "./schema";

export class MigrationRunsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async create(
    input: Pick<NewMigrationRunRow, "projectId" | "status" | "strategy" | "mappingRulesVersion">,
  ): Promise<MigrationRunRow> {
    const [row] = await this.db.insert(migrationRuns).values(input).returning();
    if (!row) {
      throw new Error("failed to insert migration run");
    }
    return row;
  }

  async getById(id: string): Promise<MigrationRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(migrationRuns)
      .where(eq(migrationRuns.id, id))
      .limit(1);
    return row;
  }

  async listByProject(projectId: string): Promise<MigrationRunRow[]> {
    return this.db
      .select()
      .from(migrationRuns)
      .where(eq(migrationRuns.projectId, projectId))
      .orderBy(desc(migrationRuns.createdAt));
  }

  async findActiveByProject(projectId: string): Promise<MigrationRunRow | undefined> {
    const rows = await this.listByProject(projectId);
    return rows.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        NewMigrationRunRow,
        | "status"
        | "objectCount"
        | "convertedCount"
        | "failedCount"
        | "reviewRequiredCount"
        | "deferredCount"
        | "waitingDependencyCount"
        | "compiledCount"
        | "compileFailedCount"
        | "testedCount"
        | "testFailedCount"
        | "stats"
        | "errorMessage"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<MigrationRunRow> {
    const [row] = await this.db
      .update(migrationRuns)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(migrationRuns.id, id))
      .returning();
    if (!row) {
      throw new Error("migration run not found");
    }
    return row;
  }
}
