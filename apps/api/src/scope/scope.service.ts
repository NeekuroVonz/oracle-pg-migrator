import {
  AuditRepository,
  ConnectionsRepository,
  DiscoveredObjectsRepository,
  MigrationScopesRepository,
  ProjectsRepository,
  toScopeDto,
} from "@migrator/db";
import {
  buildScopePreview,
  defaultScopeInput,
  normalizeScopeInput,
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
