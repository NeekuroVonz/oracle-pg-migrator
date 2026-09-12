import { ConflictError, NotFoundError } from "@migrator/shared";
import { desc, eq } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { isUniqueViolation } from "./pg-errors";
import { type AiProviderRow, aiProviders, type NewAiProviderRow } from "./schema";

export class AiProvidersRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async list(): Promise<AiProviderRow[]> {
    return this.db.select().from(aiProviders).orderBy(desc(aiProviders.updatedAt));
  }

  async listEnabled(): Promise<AiProviderRow[]> {
    return this.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.enabled, true))
      .orderBy(desc(aiProviders.updatedAt));
  }

  async getById(id: string): Promise<AiProviderRow | undefined> {
    const [row] = await this.db.select().from(aiProviders).where(eq(aiProviders.id, id)).limit(1);
    return row;
  }

  async getByIdOrThrow(id: string): Promise<AiProviderRow> {
    const row = await this.getById(id);
    if (!row) {
      throw new NotFoundError("AI provider not found");
    }
    return row;
  }

  async create(input: NewAiProviderRow): Promise<AiProviderRow> {
    try {
      const [row] = await this.db.insert(aiProviders).values(input).returning();
      if (!row) {
        throw new Error("failed to insert AI provider");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("An AI provider with that name already exists");
      }
      throw error;
    }
  }

  async update(id: string, input: Partial<NewAiProviderRow>): Promise<AiProviderRow> {
    await this.getByIdOrThrow(id);
    try {
      const [row] = await this.db
        .update(aiProviders)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(aiProviders.id, id))
        .returning();
      if (!row) {
        throw new NotFoundError("AI provider not found");
      }
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("An AI provider with that name already exists");
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.getByIdOrThrow(id);
    await this.db.delete(aiProviders).where(eq(aiProviders.id, id));
  }
}
