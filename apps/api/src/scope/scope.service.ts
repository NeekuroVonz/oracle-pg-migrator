import {
  AuditRepository,
  ConnectionsRepository,
  DiscoveredObjectsRepository,
  MigrationScopesRepository,
  ProjectsRepository,
  toScopeDto,
} from "@migrator/db";
import {
  AppError,
  buildScopePreview,
  defaultScopeInput,
  evaluateScopeObject,
  forceIncludeObjectsInScope,
  normalizeScopeInput,
  type IncludeScopeObjectsInput,
  type ScopeDto,
  type ScopePreviewQuery,
  type UpsertScopeInput,
} from "@migrator/shared";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ScopeService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly connections: ConnectionsRepository,
    private readonly objects: DiscoveredObjectsRepository,
    private readonly scopes: MigrationScopesRepository,
    private readonly audit: AuditRepository,
  ) {}

  async get(projectId: string): Promise<{
    scope: ScopeDto;
    discoveredSchemas: string[];
    objectCount: number;
  }> {
    const { catalog, discoveredSchemas } = await this.catalog(projectId);
    const saved = await this.scopes.getByProjectId(projectId);
    return {
      scope: saved ? toScopeDto(saved) : this.unsavedScope(projectId, discoveredSchemas),
      discoveredSchemas,
      objectCount: catalog.length,
    };
  }

  async upsert(projectId: string, input: UpsertScopeInput): Promise<ScopeDto> {
    await this.projects.getByIdOrThrow(projectId);
    const normalized = normalizeScopeInput(input);
    const row = await this.scopes.upsert({
      projectId,
      ...normalized,
    });
    await this.audit.append({
      projectId,
      action: "scope.updated",
      entityType: "migration_scope",
      entityId: row.id,
      metadata: {
        includeSchemas: normalized.includeSchemas,
        includeObjectTypes: normalized.includeObjectTypes,
        includeNamePatterns: normalized.includeNamePatterns,
        excludeNamePatterns: normalized.excludeNamePatterns,
        excludeObjectCount: normalized.excludeObjects.length,
        dataMode: normalized.dataMode,
        selectedTableCount: normalized.selectedTables.length,
      },
    });
    return toScopeDto(row);
  }

  async includeObjects(
    projectId: string,
    input: IncludeScopeObjectsInput,
  ): Promise<{ scope: ScopeDto; included: string[] }> {
    const { catalog, discoveredSchemas } = await this.catalog(projectId);
    const saved = await this.scopes.getByProjectId(projectId);
    const base = saved
      ? toScopeDto(saved)
      : this.unsavedScope(projectId, discoveredSchemas);
    const refs: Array<{ owner: string; name: string }> = [];
    for (const raw of input.objects) {
      const parts = raw
        .trim()
        .toUpperCase()
        .split(".")
        .filter((part) => part.length > 0);
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new AppError(
          "INVALID_OBJECT_REF",
          `Expected OWNER.NAME, got "${raw}"`,
          400,
        );
      }
      const owner = parts[0];
      const name = parts[1];
      const found = catalog.some(
        (object) =>
          object.owner.toUpperCase() === owner && object.name.toUpperCase() === name,
      );
      if (!found) {
        throw new AppError(
          "OBJECT_NOT_DISCOVERED",
          `${owner}.${name} is not in the discovered catalog. Re-run discovery first.`,
          404,
        );
      }
      refs.push({ owner, name });
    }
    const next = forceIncludeObjectsInScope(
      {
        includeSchemas: base.includeSchemas,
        includeObjectTypes: base.includeObjectTypes,
        includeNamePatterns: base.includeNamePatterns,
        excludeNamePatterns: base.excludeNamePatterns,
        excludeObjects: base.excludeObjects,
        dataMode: base.dataMode,
        selectedTables: base.selectedTables,
      },
      catalog,
      refs,
    );
    const stillExcluded: string[] = [];
    for (const ref of refs) {
      const object = catalog.find(
        (row) =>
          row.owner.toUpperCase() === ref.owner && row.name.toUpperCase() === ref.name,
      );
      if (!object) {
        stillExcluded.push(`${ref.owner}.${ref.name}`);
        continue;
      }
      const decision = evaluateScopeObject(object, next);
      if (!decision.included) {
        stillExcluded.push(`${ref.owner}.${ref.name} (${decision.reason ?? "excluded"})`);
      }
    }
    if (stillExcluded.length > 0) {
      throw new AppError(
        "SCOPE_INCLUDE_FAILED",
        `Could not bring into scope: ${stillExcluded.join(", ")}. Check Scope include/exclude rules.`,
        409,
      );
    }
    const scope = await this.upsert(projectId, next);
    const included = refs.map((ref) => `${ref.owner}.${ref.name}`);
    await this.audit.append({
      projectId,
      action: "scope.include_objects",
      entityType: "migration_scope",
      entityId: scope.id,
      metadata: { included },
    });
    return { scope, included };
  }

  async preview(projectId: string, input: UpsertScopeInput, query: ScopePreviewQuery) {
    const { catalog, discoveredSchemas } = await this.catalog(projectId);
    const saved = await this.scopes.getByProjectId(projectId);
    const normalized = normalizeScopeInput(input);
    const preview = buildScopePreview(catalog, normalized, query);
    const scope: ScopeDto = saved
      ? { ...toScopeDto(saved), ...normalized }
      : { ...this.unsavedScope(projectId, discoveredSchemas), ...normalized };
    return {
      scope,
      totals: preview.totals,
      byType: preview.byType,
      data: {
        mode: normalized.dataMode,
        selectedTableCount: preview.dataTables.length,
        tables: preview.dataTables,
      },
      objects: preview.objects,
      page: query.page,
      pageSize: query.pageSize,
      total: preview.total,
      discoveredSchemas,
      objectCount: catalog.length,
    };
  }

  private async catalog(projectId: string) {
    await this.projects.getByIdOrThrow(projectId);
    const catalog = await this.objects.listCatalog(projectId);
    const discoveredSchemas = [...new Set(catalog.map((object) => object.owner))].sort();
    if (discoveredSchemas.length > 0) {
      return { catalog, discoveredSchemas };
    }
    const connections = await this.connections.listByProject(projectId);
    const source = connections.find(
      (connection) => connection.role === "SOURCE" && connection.engine === "ORACLE",
    );
    const fallback = (source?.oracleSchemas ?? []).map((schema) => schema.toUpperCase());
    return { catalog, discoveredSchemas: [...new Set(fallback)].sort() };
  }

  private unsavedScope(projectId: string, discoveredSchemas: string[]): ScopeDto {
    return {
      id: null,
      projectId,
      saved: false,
      ...defaultScopeInput(discoveredSchemas),
      createdAt: null,
      updatedAt: null,
    };
  }
}
