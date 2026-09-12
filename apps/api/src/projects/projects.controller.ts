import {
  type CreateProjectInput,
  createProjectSchema,
  type UpdateProjectInput,
  updateProjectSchema,
} from "@migrator/shared";
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { ProjectsService } from "./projects.service";

@Controller("api/projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  create(@Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.create(body);
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.get(id);
  }

  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(updateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projects.update(id, body);
  }

  @Delete(":id")
  async remove(@Param("id", new ParseUUIDPipe()) id: string) {
    await this.projects.delete(id);
    return { ok: true };
  }
}
