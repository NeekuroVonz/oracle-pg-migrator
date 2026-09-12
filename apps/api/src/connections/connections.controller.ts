import {
  type CreateOracleConnectionInput,
  type CreatePostgresConnectionInput,
  createOracleConnectionSchema,
  createPostgresConnectionSchema,
  type UpdateOracleConnectionInput,
  type UpdatePostgresConnectionInput,
  updateOracleConnectionSchema,
  updatePostgresConnectionSchema,
} from "@migrator/shared";
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { ConnectionsService } from "./connections.service";

@Controller("api/projects/:projectId/connections")
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@Param("projectId", new ParseUUIDPipe()) projectId: string) {
    return this.connections.list(projectId);
  }

  @Post("oracle")
  createOracle(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(createOracleConnectionSchema)) body: CreateOracleConnectionInput,
  ) {
    return this.connections.createOracle(projectId, body);
  }

  @Post("postgres")
  createPostgres(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(createPostgresConnectionSchema)) body: CreatePostgresConnectionInput,
  ) {
    return this.connections.createPostgres(projectId, body);
  }

  @Patch(":connectionId/oracle")
  updateOracle(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("connectionId", new ParseUUIDPipe()) connectionId: string,
    @Body(new ZodPipe(updateOracleConnectionSchema)) body: UpdateOracleConnectionInput,
  ) {
    return this.connections.updateOracle(projectId, connectionId, body);
  }

  @Patch(":connectionId/postgres")
  updatePostgres(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("connectionId", new ParseUUIDPipe()) connectionId: string,
    @Body(new ZodPipe(updatePostgresConnectionSchema)) body: UpdatePostgresConnectionInput,
  ) {
    return this.connections.updatePostgres(projectId, connectionId, body);
  }

  @Delete(":connectionId")
  async remove(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("connectionId", new ParseUUIDPipe()) connectionId: string,
  ) {
    await this.connections.delete(projectId, connectionId);
    return { ok: true };
  }

  @Post(":connectionId/test")
  test(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("connectionId", new ParseUUIDPipe()) connectionId: string,
  ) {
    return this.connections.test(projectId, connectionId);
  }
}
