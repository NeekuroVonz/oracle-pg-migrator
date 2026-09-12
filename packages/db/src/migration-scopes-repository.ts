import { eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type MigrationScopeRow, migrationScopes, type NewMigrationScopeRow } from "./schema";

export class MigrationScopesRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async getByProjectId(projectId: string): Promise<MigrationScopeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(migrationScopes)
      .where(eq(migrationScopes.projectId, projectId))
      .limit(1);
    return row;
  }

  async upsert(
    input: Pick<
      NewMigrationScopeRow,
      | "projectId"
      | "includeSchemas"
      | "includeObjectTypes"
      | "includeNamePatterns"
      | "excludeNamePatterns"
      | "excludeObjects"
      | "dataMode"
      | "selectedTables"
    >,
  ): Promise<MigrationScopeRow> {
    const [row] = await this.db
      .insert(migrationScopes)
      .values(input)
      .onConflictDoUpdate({
        target: migrationScopes.projectId,
        set: {
          includeSchemas: input.includeSchemas,
          includeObjectTypes: input.includeObjectTypes,
          includeNamePatterns: input.includeNamePatterns,
          excludeNamePatterns: input.excludeNamePatterns,
          excludeObjects: input.excludeObjects,
          dataMode: input.dataMode,
          selectedTables: input.selectedTables,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) {
      throw new Error("failed to upsert migration scope");
    }
    return row;
  }
}
