import { ConflictError, NotFoundError } from "@migrator/shared";
import { and, desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { isUniqueViolation } from "./pg-errors";
import { type ConnectionRow, databaseConnections, type NewConnectionRow } from "./schema";

export class ConnectionsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async listByProject(projectId: string): Promise<ConnectionRow[]> {
    return this.db
      .select()
      .from(databaseConnections)
      .where(eq(databaseConnections.projectId, projectId))
      .orderBy(desc(databaseConnections.updatedAt));
  }

  async getByProjectRole(
    projectId: string,
    role: ConnectionRow["role"],
  ): Promise<ConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(databaseConnections)
      .where(and(eq(databaseConnections.projectId, projectId), eq(databaseConnections.role, role)))
      .limit(1);
    return row;
  }

  async getById(id: string): Promise<ConnectionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(databaseConnections)
      .where(eq(databaseConnections.id, id))
      .limit(1);
    return row;
  }

  async getByIdOrThrow(id: string): Promise<ConnectionRow> {
    const row = await this.getById(id);
    if (!row) {
      throw new NotFoundError("Connection not found");
    }
    return row;
  }

  async create(input: NewConnectionRow): Promise<ConnectionRow> {
    try {
      const [row] = await this.db.insert(databaseConnections).values(input).returning();
      if (!row) {
        throw new Error("failed to insert connection");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("This project already has a connection for that role");
      }
      throw error;
    }
  }

  async update(id: string, input: Partial<NewConnectionRow>): Promise<ConnectionRow> {
    await this.getByIdOrThrow(id);
    const [row] = await this.db
      .update(databaseConnections)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(databaseConnections.id, id))
      .returning();
    if (!row) {
      throw new NotFoundError("Connection not found");
    }
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.getByIdOrThrow(id);
    await this.db.delete(databaseConnections).where(eq(databaseConnections.id, id));
  }
}
