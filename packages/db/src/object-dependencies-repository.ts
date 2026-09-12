import type { OracleObjectType } from "@migrator/shared";
import { and, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { MetadataDatabase } from "./client";
import { formatDatabaseError } from "./pg-errors";
import { discoveredObjects, objectDependencies } from "./schema";

export interface ObjectDependencyEdgeInput {
  fromObjectId: string;
  toObjectId: string;
  dependencyType: string;
}

export interface ObjectDependencyListRow {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  dependencyType: string;
  fromOwner: string;
  fromName: string;
  fromType: OracleObjectType;
  toOwner: string;
  toName: string;
  toType: OracleObjectType;
}

/** PostgreSQL bind limit is 65535; each edge binds 5 parameters. */
export const OBJECT_DEPENDENCY_INSERT_BATCH_SIZE = 1000;

export function uniqueObjectDependencyEdges(
  edges: ObjectDependencyEdgeInput[],
): ObjectDependencyEdgeInput[] {
  const seen = new Set<string>();
  const unique: ObjectDependencyEdgeInput[] = [];
  for (const edge of edges) {
    const key = `${edge.fromObjectId}\0${edge.toObjectId}\0${edge.dependencyType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(edge);
  }
  return unique;
}

export function chunkObjectDependencyEdges<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be positive");
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

export class ObjectDependenciesRepository {
  constructor(private readonly db: MetadataDatabase) {}

  async replaceForRun(
    projectId: string,
    runId: string,
    edges: ObjectDependencyEdgeInput[],
  ): Promise<void> {
    const unique = uniqueObjectDependencyEdges(edges);
    try {
      await this.db.transaction(async (tx) => {
        await tx.delete(objectDependencies).where(eq(objectDependencies.projectId, projectId));
        const chunks = chunkObjectDependencyEdges(unique, OBJECT_DEPENDENCY_INSERT_BATCH_SIZE);
        for (const chunk of chunks) {
          if (chunk.length === 0) {
            continue;
          }
          await tx.insert(objectDependencies).values(
            chunk.map((edge) => ({
              projectId,
              discoveryRunId: runId,
              fromObjectId: edge.fromObjectId,
              toObjectId: edge.toObjectId,
              dependencyType: edge.dependencyType,
            })),
          );
        }
      });
    } catch (error) {
      const reason = formatDatabaseError(error);
      throw new Error(
        `Failed to save ${unique.length} object dependencies to the metadata database: ${reason}`,
      );
    }
  }

  async listForObject(projectId: string, objectId: string): Promise<ObjectDependencyListRow[]> {
    const fromObjects = alias(discoveredObjects, "from_objects");
    const toObjects = alias(discoveredObjects, "to_objects");
    const rows = await this.db
      .select({
        id: objectDependencies.id,
        fromObjectId: objectDependencies.fromObjectId,
        toObjectId: objectDependencies.toObjectId,
        dependencyType: objectDependencies.dependencyType,
        fromOwner: fromObjects.owner,
        fromName: fromObjects.name,
        fromType: fromObjects.objectType,
        toOwner: toObjects.owner,
        toName: toObjects.name,
        toType: toObjects.objectType,
      })
      .from(objectDependencies)
      .innerJoin(fromObjects, eq(objectDependencies.fromObjectId, fromObjects.id))
      .innerJoin(toObjects, eq(objectDependencies.toObjectId, toObjects.id))
      .where(
        and(
          eq(objectDependencies.projectId, projectId),
          or(
            eq(objectDependencies.fromObjectId, objectId),
            eq(objectDependencies.toObjectId, objectId),
          ),
        ),
      );
    return rows;
  }

  async listByProject(projectId: string): Promise<ObjectDependencyListRow[]> {
    const fromObjects = alias(discoveredObjects, "from_objects");
    const toObjects = alias(discoveredObjects, "to_objects");
    return this.db
      .select({
        id: objectDependencies.id,
        fromObjectId: objectDependencies.fromObjectId,
        toObjectId: objectDependencies.toObjectId,
        dependencyType: objectDependencies.dependencyType,
        fromOwner: fromObjects.owner,
        fromName: fromObjects.name,
        fromType: fromObjects.objectType,
        toOwner: toObjects.owner,
        toName: toObjects.name,
        toType: toObjects.objectType,
      })
      .from(objectDependencies)
      .innerJoin(fromObjects, eq(objectDependencies.fromObjectId, fromObjects.id))
      .innerJoin(toObjects, eq(objectDependencies.toObjectId, toObjects.id))
      .where(eq(objectDependencies.projectId, projectId));
  }
}
