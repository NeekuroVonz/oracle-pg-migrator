import {
  type AuditRepository,
  type DiscoveredObjectRow,
  type DiscoveredObjectsRepository,
  type DiscoveryRunsRepository,
  formatDatabaseError,
  type ObjectDependenciesRepository,
  uniqueObjectDependencyEdges,
} from "@migrator/db";
import type { CatalogObject, ObjectDefinition, OracleReadOnlyClient } from "@migrator/oracle";
import type { DiscoveredObjectMetadata } from "@migrator/shared";

function objectKey(object: Pick<CatalogObject, "owner" | "name" | "objectType">): string {
  return `${object.owner}.${object.name}.${object.objectType}`;
}

export async function runDiscovery(input: {
  projectId: string;
  runId: string;
  schemas: string[];
  client: OracleReadOnlyClient;
  runs: DiscoveryRunsRepository;
  objects: DiscoveredObjectsRepository;
  dependencies: ObjectDependenciesRepository;
  audit: AuditRepository;
}): Promise<void> {
  const startedAt = new Date();
  await input.runs.update(input.runId, {
    status: "RUNNING",
    startedAt,
    errorMessage: null,
    stats: { phase: "catalog" },
  });

  try {
    const existing = await input.objects.listByNaturalKeys(input.projectId);
    const totals: Record<string, number> = {};
    let extractedCount = 0;
    let skippedUnchangedCount = 0;

    async function persist(
      object: CatalogObject,
      definition: ObjectDefinition | undefined,
      prior: DiscoveredObjectRow | undefined,
    ): Promise<void> {
      const metadata: DiscoveredObjectMetadata = {
        ...object.metadata,
        extractError: definition?.error ?? null,
      };
      await input.objects.upsert({
        projectId: input.projectId,
        lastSeenRunId: input.runId,
        owner: object.owner,
        name: object.name,
        objectType: object.objectType,
        status: "DISCOVERED",
        sourceText: definition?.skipped
          ? (prior?.sourceText ?? null)
          : (definition?.source ?? prior?.sourceText ?? null),
        sourceHash: definition?.hash ?? prior?.sourceHash ?? null,
        estimatedRowCount: object.estimatedRowCount,
        byteSize: object.byteSize,
        lastDdlTime: object.lastDdlTime,
        metadata,
        extractedAt: definition?.skipped
          ? (prior?.extractedAt ?? null)
          : definition?.source
            ? new Date()
            : (prior?.extractedAt ?? null),
      });
    }

    const inventory = await input.client.discoverInventory(input.schemas, fingerprints(existing), {
      onCatalog: async (objects) => {
        for (const object of objects) {
          totals[object.objectType] = (totals[object.objectType] ?? 0) + 1;
          await persist(object, undefined, existing.get(objectKey(object)));
        }
        await input.runs.update(input.runId, {
          objectCount: objects.length,
          stats: { byType: totals, phase: "extracting_ddl" },
        });
      },
      onDefinition: async ({ object, definition, done, total }) => {
        if (definition.skipped) {
          skippedUnchangedCount += 1;
        } else if (definition.source) {
          extractedCount += 1;
        }
        await persist(object, definition, existing.get(objectKey(object)));
        if (done === 1 || done % 10 === 0 || done === total) {
          await input.runs.update(input.runId, {
            objectCount: total,
            extractedCount,
            skippedUnchangedCount,
            stats: { byType: totals, phase: "extracting_ddl", processed: done, total },
          });
        }
      },
      onDependencies: async () => {
        await input.runs.update(input.runId, {
          stats: { byType: totals, phase: "dependencies" },
        });
      },
    });

    const after = await input.objects.listByNaturalKeys(input.projectId);
    const edges: Array<{ fromObjectId: string; toObjectId: string; dependencyType: string }> = [];
    for (const dependency of inventory.dependencies) {
      const from = after.get(`${dependency.owner}.${dependency.name}.${dependency.objectType}`);
      const to = after.get(
        `${dependency.referencedOwner}.${dependency.referencedName}.${dependency.referencedType}`,
      );
      if (!from || !to || from.id === to.id) {
        continue;
      }
      edges.push({
        fromObjectId: from.id,
        toObjectId: to.id,
        dependencyType: dependency.dependencyType,
      });
    }
    await input.dependencies.replaceForRun(
      input.projectId,
      input.runId,
      uniqueObjectDependencyEdges(edges),
    );
    await input.objects.deleteUnseen(input.projectId, input.runId);

    await input.runs.update(input.runId, {
      status: "SUCCEEDED",
      objectCount: inventory.objects.length,
      extractedCount,
      skippedUnchangedCount,
      stats: { byType: totals, phase: "done" },
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.projectId,
      action: "discovery.completed",
      entityType: "discovery_run",
      entityId: input.runId,
      metadata: {
        objectCount: inventory.objects.length,
        extractedCount,
        skippedUnchangedCount,
      },
    });
  } catch (error) {
    const message = formatDatabaseError(error, "Discovery failed");
    await input.runs.update(input.runId, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: new Date(),
    });
    await input.audit.append({
      projectId: input.projectId,
      action: "discovery.failed",
      entityType: "discovery_run",
      entityId: input.runId,
      metadata: { message },
    });
    throw error;
  }
}

function fingerprints(
  existing: Map<string, DiscoveredObjectRow>,
): Map<string, { lastDdlTime: Date | null; sourceHash: string | null }> {
  return new Map(
    [...existing.entries()].map(([key, row]) => [
      key,
      { lastDdlTime: row.lastDdlTime, sourceHash: row.sourceHash },
    ]),
  );
}
