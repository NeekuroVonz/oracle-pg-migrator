import { AuditRepository, ProjectsRepository, toProjectDto } from "@migrator/db";
import type { CreateProjectInput, ProjectDto, UpdateProjectInput } from "@migrator/shared";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(): Promise<ProjectDto[]> {
    const rows = await this.projects.list();
    return rows.map(toProjectDto);
  }

  async get(id: string): Promise<ProjectDto> {
    return toProjectDto(await this.projects.getByIdOrThrow(id));
  }

  async create(input: CreateProjectInput): Promise<ProjectDto> {
    const row = await this.projects.create({
      name: input.name,
      description: input.description,
    });
    await this.audit.append({
      projectId: row.id,
      action: "project.created",
      entityType: "project",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return toProjectDto(row);
  }

  async update(id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const row = await this.projects.update(id, {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
    await this.audit.append({
      projectId: row.id,
      action: "project.updated",
      entityType: "project",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return toProjectDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.projects.delete(id);
    await this.audit.append({
      projectId: id,
      action: "project.deleted",
      entityType: "project",
      entityId: id,
    });
  }
}
