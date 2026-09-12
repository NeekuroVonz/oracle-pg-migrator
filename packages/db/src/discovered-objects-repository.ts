import {
  type CompileStatus,
  type DiscoveredObjectSortField,
  NotFoundError,
  type ObjectStatus,
  type OracleObjectType,
  type ReconcileAction,
  type RiskLevel,
  type TargetState,
  type TestAttemptStatus,
} from "@migrator/shared";
import { and, asc, count, desc, eq, gt, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { MetadataDatabase } from "./client";
import { type DiscoveredObjectRow, discoveredObjects, type NewDiscoveredObjectRow } from "./schema";

export interface ListDiscoveredObjectsQuery {
  projectId: string;
  runId?: string | null;
  owner?: string;
  objectType?: OracleObjectType;
  q?: string;
  extracted?: "yes" | "no";
  hasRows?: "yes" | "no";
  sortBy?: DiscoveredObjectSortField;
  sortDir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

function inventoryOrderBy(sortBy: DiscoveredObjectSortField, sortDir: "asc" | "desc") {
  const direction = sortDir === "desc" ? desc : asc;
  const extractedRank = sql`CASE WHEN ${discoveredObjects.sourceHash} IS NULL THEN 0 ELSE 1 END`;
  const columns = {
    owner: discoveredObjects.owner,
    name: discoveredObjects.name,
    objectType: discoveredObjects.objectType,
    estimatedRowCount: discoveredObjects.estimatedRowCount,
    byteSize: discoveredObjects.byteSize,
    lastDdlTime: discoveredObjects.lastDdlTime,
    extracted: extractedRank,
  } as const;
  const tieBreaker = sortBy === "name" ? discoveredObjects.owner : discoveredObjects.name;
  if (sortBy === "estimatedRowCount" || sortBy === "byteSize" || sortBy === "lastDdlTime") {
    const ordered =
      sortDir === "desc"
        ? sql`${columns[sortBy]} DESC NULLS LAST`
        : sql`${columns[sortBy]} ASC NULLS LAST`;
    return [ordered, direction(tieBreaker)];
  }
  return [direction(columns[sortBy]), direction(tieBreaker)];
}

export class DiscoveredObjectsRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async listFingerprints(projectId: string): Promise<DiscoveredObjectRow[]> {
    return this.db
      .select()
      .from(discoveredObjects)
      .where(eq(discoveredObjects.projectId, projectId));
  }

  async upsert(input: NewDiscoveredObjectRow): Promise<DiscoveredObjectRow> {
    const [row] = await this.db
      .insert(discoveredObjects)
      .values(input)
      .onConflictDoUpdate({
        target: [
          discoveredObjects.projectId,
          discoveredObjects.owner,
          discoveredObjects.name,
          discoveredObjects.objectType,
        ],
        set: {
          lastSeenRunId: sql`excluded.last_seen_run_id`,
          status: sql`excluded.status`,
          sourceText: sql`excluded.source_text`,
          sourceHash: sql`excluded.source_hash`,
          estimatedRowCount: sql`excluded.estimated_row_count`,
          byteSize: sql`excluded.byte_size`,
          lastDdlTime: sql`excluded.last_ddl_time`,
          metadata: sql`excluded.metadata`,
          extractedAt: sql`excluded.extracted_at`,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) {
      throw new Error("failed to upsert discovered object");
    }
    return row;
  }

  async getByIdOrThrow(id: string): Promise<DiscoveredObjectRow> {
    const [row] = await this.db
      .select()
      .from(discoveredObjects)
      .where(eq(discoveredObjects.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundError("Discovered object not found");
    }
    return row;
  }

  async list(query: ListDiscoveredObjectsQuery): Promise<{
    rows: DiscoveredObjectRow[];
    total: number;
  }> {
    const filters = [eq(discoveredObjects.projectId, query.projectId)];
    if (query.runId) {
      filters.push(eq(discoveredObjects.lastSeenRunId, query.runId));
    }
    if (query.owner) {
      filters.push(eq(discoveredObjects.owner, query.owner.toUpperCase()));
    }
    if (query.objectType) {
      filters.push(eq(discoveredObjects.objectType, query.objectType));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const search = or(
        ilike(discoveredObjects.name, pattern),
        ilike(discoveredObjects.owner, pattern),
      );
      if (search) {
        filters.push(search);
      }
    }
    if (query.extracted === "yes") {
      filters.push(isNotNull(discoveredObjects.sourceHash));
    } else if (query.extracted === "no") {
      filters.push(isNull(discoveredObjects.sourceHash));
    }
    if (query.hasRows === "yes") {
      filters.push(gt(discoveredObjects.estimatedRowCount, 0));
    } else if (query.hasRows === "no") {
      const emptyRows = or(
        isNull(discoveredObjects.estimatedRowCount),
        eq(discoveredObjects.estimatedRowCount, 0),
      );
      if (emptyRows) {
        filters.push(emptyRows);
      }
    }
    const where = and(...filters);
    const [totalRow] = await this.db
      .select({ total: count() })
      .from(discoveredObjects)
      .where(where);
    const rows = await this.db
      .select()
      .from(discoveredObjects)
      .where(where)
      .orderBy(...inventoryOrderBy(query.sortBy ?? "owner", query.sortDir ?? "asc"))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { rows, total: Number(totalRow?.total ?? 0) };
  }

  async listOwners(projectId: string, runId?: string): Promise<string[]> {
    const filters = [eq(discoveredObjects.projectId, projectId)];
    if (runId) {
      filters.push(eq(discoveredObjects.lastSeenRunId, runId));
    }
    const rows = await this.db
      .select({ owner: discoveredObjects.owner })
      .from(discoveredObjects)
      .where(and(...filters))
      .groupBy(discoveredObjects.owner)
      .orderBy(discoveredObjects.owner);
    return rows.map((row) => row.owner);
  }

  async countByType(projectId: string, runId?: string): Promise<Record<string, number>> {
    const filters = [eq(discoveredObjects.projectId, projectId)];
    if (runId) {
      filters.push(eq(discoveredObjects.lastSeenRunId, runId));
    }
    const rows = await this.db
      .select({
        objectType: discoveredObjects.objectType,
        total: count(),
      })
      .from(discoveredObjects)
      .where(and(...filters))
      .groupBy(discoveredObjects.objectType);
    const totals: Record<string, number> = {};
    for (const row of rows) {
      totals[row.objectType] = Number(row.total);
    }
    return totals;
  }

  async deleteUnseen(projectId: string, runId: string): Promise<void> {
    await this.db
      .delete(discoveredObjects)
      .where(
        and(
          eq(discoveredObjects.projectId, projectId),
          sql`${discoveredObjects.lastSeenRunId} IS DISTINCT FROM ${runId}`,
        ),
      );
  }

  async listByNaturalKeys(projectId: string): Promise<Map<string, DiscoveredObjectRow>> {
    const rows = await this.listFingerprints(projectId);
    const map = new Map<string, DiscoveredObjectRow>();
    for (const row of rows) {
      map.set(`${row.owner}.${row.name}.${row.objectType}`, row);
    }
    return map;
  }

  async listCatalog(
    projectId: string,
  ): Promise<Array<{ id: string; owner: string; name: string; objectType: OracleObjectType }>> {
    return this.db
      .select({
        id: discoveredObjects.id,
        owner: discoveredObjects.owner,
        name: discoveredObjects.name,
        objectType: discoveredObjects.objectType,
      })
      .from(discoveredObjects)
      .where(eq(discoveredObjects.projectId, projectId))
      .orderBy(discoveredObjects.owner, discoveredObjects.objectType, discoveredObjects.name);
  }

  async updateConversion(
    id: string,
    input: {
      status?: ObjectStatus;
      targetSchema?: string | null;
      targetName?: string | null;
      targetSql?: string | null;
      riskLevel?: RiskLevel | null;
      attemptCount?: number;
      compileStatus?: CompileStatus | null;
      compileError?: string | null;
      testStatus?: TestAttemptStatus | null;
      testError?: string | null;
      lastConversionRunId?: string | null;
      targetState?: TargetState | null;
      reconcileAction?: ReconcileAction | null;
      previousDesiredShapeHash?: string | null;
      desiredShapeHash?: string | null;
      previousTargetShapeHash?: string | null;
      targetShapeHash?: string | null;
      reconcileSql?: string | null;
      reconcileDiff?: Record<string, unknown> | null;
    },
  ): Promise<DiscoveredObjectRow> {
    const [row] = await this.db
      .update(discoveredObjects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(discoveredObjects.id, id))
      .returning();
    if (!row) {
      throw new NotFoundError("Discovered object not found");
    }
    return row;
  }
}
