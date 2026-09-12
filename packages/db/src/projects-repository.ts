import { ConflictError, NotFoundError } from "@migrator/shared";
import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { isUniqueViolation } from "./pg-errors";
import { type NewProjectRow, type ProjectRow, projects } from "./schema";

export class ProjectsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async list(): Promise<ProjectRow[]> {
    return this.db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async getById(id: string): Promise<ProjectRow | undefined> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row;
  }

  async getByIdOrThrow(id: string): Promise<ProjectRow> {
    const row = await this.getById(id);
    if (!row) {
      throw new NotFoundError("Project not found");
    }
    return row;
  }

  async create(input: Pick<NewProjectRow, "name" | "description">): Promise<ProjectRow> {
    try {
      const [row] = await this.db.insert(projects).values(input).returning();
      if (!row) {
        throw new Error("failed to insert project");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("A project with this name already exists");
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: Partial<Pick<NewProjectRow, "name" | "description">>,
  ): Promise<ProjectRow> {
    await this.getByIdOrThrow(id);
    try {
      const [row] = await this.db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      if (!row) {
        throw new NotFoundError("Project not found");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("A project with this name already exists");
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.getByIdOrThrow(id);
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}
