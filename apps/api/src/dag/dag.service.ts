import {
  DiscoveredObjectsRepository,
  MigrationRunObjectsRepository,
  MigrationRunsRepository,
  MigrationScopesRepository,
  ObjectDependenciesRepository,
  ProjectsRepository,
} from "@migrator/db";
import { buildObjectDag, type DagObjectInput, toObjectDagDto } from "@migrator/dependency-graph";
import {
  AppError,
  evaluateScopeCatalog,
  type ConversionTrack,
  CONVERSION_TRACKS,
  NotFoundError,
  type ObjectDagDto,
  type ObjectDagQuery,
  typesForTracks,
} from "@migrator/shared";
import { Injectable } from "@nestjs/common";

function toDagNodes(
  rows: Array<{ id: string; owner: string; name: string; objectType: string }>,
): DagObjectInput[] {
  return rows.map((row) => ({
    id: row.id,
    owner: row.owner,
    name: row.name,
    objectType: row.objectType,
  }));
}

@Injectable()
export class DagService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly scopes: MigrationScopesRepository,
    private readonly dependencies: ObjectDependenciesRepository,
    private readonly runs: MigrationRunsRepository,
    private readonly runObjects: MigrationRunObjectsRepository,
  ) {}

  async getProjectDag(projectId: string, query: ObjectDagQuery): Promise<ObjectDagDto> {
    await this.projects.getByIdOrThrow(projectId);
    const catalog = await this.objects.listFingerprints(projectId);
    if (catalog.length === 0) {
      throw new AppError(
        "DISCOVERY_REQUIRED",
        "Discover Oracle objects before inspecting the dependency graph",
        409,
      );
    }
    const saved = await this.scopes.getByProjectId(projectId);
    if (!saved) {
      throw new AppError(
        "SCOPE_REQUIRED",
        "Save a migration scope before inspecting the dependency graph",
        409,
      );
    }
    const rules = {
      includeSchemas: saved.includeSchemas,
      includeObjectTypes: saved.includeObjectTypes,
      includeNamePatterns: saved.includeNamePatterns,
      excludeNamePatterns: saved.excludeNamePatterns,
      excludeObjects: saved.excludeObjects,
      dataMode: saved.dataMode,
      selectedTables: saved.selectedTables,
    };
    const included = evaluateScopeCatalog(catalog, rules).filter((row) => row.included);
    const tracks: ConversionTrack[] =
      query.tracks !== undefined
        ? query.tracks
        : query.strategy === "MAXIMUM_ACCURACY"
          ? [...CONVERSION_TRACKS]
          : ["SCHEMA", "VIEWS"];
    const selectedTypes = typesForTracks(tracks);
    const catalogById = new Map(catalog.map((row) => [row.id, row]));
    const unavailableIds = included
      .filter((row) => {
        if (selectedTypes.has(row.objectType)) {
          return false;
        }
        const live = catalogById.get(row.id);
        return !live?.targetSql || live.status === "FAILED";
      })
      .map((row) => row.id);
    const edges = await this.dependencies.listByProject(projectId);
    return toObjectDagDto(
      buildObjectDag({
        nodes: toDagNodes(catalog),
        selectedIds: included.map((row) => row.id),
        unavailableIds,
        edges: edges.map((edge) => ({
          fromId: edge.fromObjectId,
          toId: edge.toObjectId,
          dependencyType: edge.dependencyType,
        })),
      }),
    );
  }

  async getRunDag(projectId: string, runId: string): Promise<ObjectDagDto> {
    await this.projects.getByIdOrThrow(projectId);
    const run = await this.runs.getById(runId);
    if (!run || run.projectId !== projectId) {
      throw new NotFoundError("Migration run not found");
    }
    const members = await this.runObjects.listObjects(runId);
    const catalog = await this.objects.listFingerprints(projectId);
    const edges = await this.dependencies.listByProject(projectId);
    return toObjectDagDto(
      buildObjectDag({
        nodes: toDagNodes(catalog.length > 0 ? catalog : members),
        selectedIds: members.map((row) => row.id),
        unavailableIds: members.filter((row) => row.deferred).map((row) => row.id),
        edges: edges.map((edge) => ({
          fromId: edge.fromObjectId,
          toId: edge.toObjectId,
          dependencyType: edge.dependencyType,
        })),
      }),
    );
  }
}
