import type {
  AiProviderDto,
  AiProviderTestResult,
  ConnectionDto,
  ConnectionTestResult,
  ConversionObjectDto,
  ConversionRunDetailDto,
  CreateAiProviderInput,
  DataCopyRunDto,
  DeployRunDto,
  DiscoveredObjectDto,
  DiscoveryInventoryDto,
  DiscoveryRunDto,
  MigrationReportDto,
  MigrationReportSqlDto,
  MigrationRunDto,
  MigrationStrategy,
  ObjectDagDto,
  ObjectDependencyDto,
  ProjectDto,
  ScopeDto,
  ScopePreviewDto,
  StartConversionInput,
  UpdateAiProviderInput,
  UpsertScopeInput,
  ValidatorPoolDto,
} from "@migrator/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const errorBody = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiClientError(
      errorBody?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      errorBody?.error?.code,
    );
  }
  return body as T;
}

export const api = {
  listProjects: () => request<ProjectDto[]>("/api/projects"),
  getProject: (id: string) => request<ProjectDto>(`/api/projects/${id}`),
  createProject: (input: { name: string; description?: string }) =>
    request<ProjectDto>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  updateProject: (id: string, input: { name?: string; description?: string | null }) =>
    request<ProjectDto>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  listConnections: (projectId: string) =>
    request<ConnectionDto[]>(`/api/projects/${projectId}/connections`),
  createOracle: (projectId: string, input: unknown) =>
    request<ConnectionDto>(`/api/projects/${projectId}/connections/oracle`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createPostgres: (projectId: string, input: unknown) =>
    request<ConnectionDto>(`/api/projects/${projectId}/connections/postgres`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateOracle: (projectId: string, connectionId: string, input: unknown) =>
    request<ConnectionDto>(`/api/projects/${projectId}/connections/${connectionId}/oracle`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  updatePostgres: (projectId: string, connectionId: string, input: unknown) =>
    request<ConnectionDto>(`/api/projects/${projectId}/connections/${connectionId}/postgres`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteConnection: (projectId: string, connectionId: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/connections/${connectionId}`, {
      method: "DELETE",
    }),
  testConnection: (projectId: string, connectionId: string) =>
    request<ConnectionTestResult>(`/api/projects/${projectId}/connections/${connectionId}/test`, {
      method: "POST",
    }),
  listDiscoverySchemas: (projectId: string) =>
    request<{ schemas: string[]; suggested: string[] }>(
      `/api/projects/${projectId}/discovery/schemas`,
    ),
  getDiscovery: (projectId: string) =>
    request<{ run: DiscoveryRunDto | null }>(`/api/projects/${projectId}/discovery`),
  startDiscovery: (projectId: string, schemas: string[]) =>
    request<DiscoveryRunDto>(`/api/projects/${projectId}/discovery`, {
      method: "POST",
      body: JSON.stringify({ schemas }),
    }),
  getInventory: (projectId: string, query: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null && String(value).length > 0) {
        params.set(key, String(value));
      }
    }
    const suffix = params.toString();
    return request<DiscoveryInventoryDto>(
      `/api/projects/${projectId}/objects${suffix ? `?${suffix}` : ""}`,
    );
  },
  getDiscoveredObject: (projectId: string, objectId: string) =>
    request<DiscoveredObjectDto>(`/api/projects/${projectId}/objects/${objectId}`),
  getObjectDependencies: (projectId: string, objectId: string) =>
    request<ObjectDependencyDto[]>(`/api/projects/${projectId}/objects/${objectId}/dependencies`),
  getScope: (projectId: string) =>
    request<{ scope: ScopeDto; discoveredSchemas: string[]; objectCount: number }>(
      `/api/projects/${projectId}/scope`,
    ),
  saveScope: (projectId: string, input: UpsertScopeInput) =>
    request<ScopeDto>(`/api/projects/${projectId}/scope`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  previewScope: (
    projectId: string,
    input: UpsertScopeInput,
    query: Record<string, string | number | undefined>,
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null && String(value).length > 0) {
        params.set(key, String(value));
      }
    }
    const suffix = params.toString();
    return request<ScopePreviewDto>(
      `/api/projects/${projectId}/scope/preview${suffix ? `?${suffix}` : ""}`,
      { method: "POST", body: JSON.stringify(input) },
    );
  },
  listRuns: (projectId: string) => request<MigrationRunDto[]>(`/api/projects/${projectId}/runs`),
  startRun: (projectId: string, input: StartConversionInput = { strategy: "FAST" }) =>
    request<MigrationRunDto>(`/api/projects/${projectId}/runs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRun: (
    projectId: string,
    runId: string,
    query: Record<string, string | number | undefined> = {},
  ) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value != null && String(value).length > 0) {
        params.set(key, String(value));
      }
    }
    const suffix = params.toString();
    return request<ConversionRunDetailDto>(
      `/api/projects/${projectId}/runs/${runId}${suffix ? `?${suffix}` : ""}`,
    );
  },
  getRunObject: (projectId: string, runId: string, objectId: string) =>
    request<ConversionObjectDto>(`/api/projects/${projectId}/runs/${runId}/objects/${objectId}`),
  getProjectDag: (projectId: string, strategy?: MigrationStrategy) => {
    const suffix = strategy ? `?strategy=${strategy}` : "";
    return request<ObjectDagDto>(`/api/projects/${projectId}/dag${suffix}`);
  },
  getRunDag: (projectId: string, runId: string) =>
    request<ObjectDagDto>(`/api/projects/${projectId}/runs/${runId}/dag`),
  getRunReport: (projectId: string, runId: string) =>
    request<MigrationReportDto>(`/api/projects/${projectId}/runs/${runId}/report`),
  getRunReportSql: (projectId: string, runId: string) =>
    request<MigrationReportSqlDto>(`/api/projects/${projectId}/runs/${runId}/report/sql`),
  getRunDataCopy: (projectId: string, runId: string) =>
    request<DataCopyRunDto | null>(`/api/projects/${projectId}/runs/${runId}/data-copy`),
  startRunDataCopy: (projectId: string, runId: string, input: { chunkSize?: number } = {}) =>
    request<DataCopyRunDto>(`/api/projects/${projectId}/runs/${runId}/data-copy`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRunDeploy: (projectId: string, runId: string) =>
    request<DeployRunDto | null>(`/api/projects/${projectId}/runs/${runId}/deploy`),
  startRunDeploy: (projectId: string, runId: string) =>
    request<DeployRunDto>(`/api/projects/${projectId}/runs/${runId}/deploy`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  getValidatorPool: () => request<ValidatorPoolDto>("/api/validator-pool"),
  listAiProviders: () => request<AiProviderDto[]>("/api/ai-providers"),
  createAiProvider: (input: CreateAiProviderInput) =>
    request<AiProviderDto>("/api/ai-providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateAiProvider: (id: string, input: UpdateAiProviderInput) =>
    request<AiProviderDto>(`/api/ai-providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  testAiProvider: (id: string) =>
    request<AiProviderTestResult>(`/api/ai-providers/${id}/test`, { method: "POST" }),
  deleteAiProvider: (id: string) =>
    request<{ ok: boolean }>(`/api/ai-providers/${id}`, { method: "DELETE" }),
};
