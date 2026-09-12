import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type AuditLogRow, auditLogs } from "./schema";

export class AuditRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async append(input: {
    projectId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogRow> {
    const [row] = await this.db
      .insert(auditLogs)
      .values({
        projectId: input.projectId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata ?? {},
      })
      .returning();
    if (!row) {
      throw new Error("failed to insert audit log");
    }
    return row;
  }

  async listByProject(projectId: string, limit = 50): Promise<AuditLogRow[]> {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectId, projectId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}
