import { eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DataCopyTableRow, dataCopyTables, type NewDataCopyTableRow } from "./schema";

export class DataCopyTablesRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async replace(
    copyRunId: string,
    items: Array<
      Pick<
        NewDataCopyTableRow,
        "objectId" | "owner" | "name" | "targetSchema" | "targetName" | "status"
      >
    >,
  ): Promise<DataCopyTableRow[]> {
    await this.db.delete(dataCopyTables).where(eq(dataCopyTables.copyRunId, copyRunId));
    if (items.length === 0) {
      return [];
    }
    return this.db
      .insert(dataCopyTables)
      .values(items.map((item) => ({ ...item, copyRunId })))
      .returning();
  }

  async listByCopyRun(copyRunId: string): Promise<DataCopyTableRow[]> {
    return this.db
      .select()
      .from(dataCopyTables)
      .where(eq(dataCopyTables.copyRunId, copyRunId))
      .orderBy(dataCopyTables.owner, dataCopyTables.name);
  }

  async update(
    id: string,
    input: Partial<
      Pick<
        NewDataCopyTableRow,
        "status" | "oracleRows" | "postgresRows" | "copiedRows" | "lastOffset" | "errorMessage"
      >
    >,
  ): Promise<DataCopyTableRow> {
    const [row] = await this.db
      .update(dataCopyTables)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(dataCopyTables.id, id))
      .returning();
    if (!row) {
      throw new Error("data copy table not found");
    }
    return row;
  }
}
