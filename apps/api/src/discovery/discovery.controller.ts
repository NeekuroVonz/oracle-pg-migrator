import {
  type ListDiscoveredObjectsQuery,
  listDiscoveredObjectsQuerySchema,
  type StartDiscoveryInput,
  startDiscoverySchema,
} from "@migrator/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { DiscoveryService } from "./discovery.service";

@Controller("api/projects/:projectId")
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get("discovery/schemas")
  listSchemas(@Param("projectId", new ParseUUIDPipe()) projectId: string) {
    return this.discovery.listSchemas(projectId);
  }

  @Get("discovery")
  latest(@Param("projectId", new ParseUUIDPipe()) projectId: string) {
    return this.discovery.latest(projectId);
  }

  @Post("discovery")
  start(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(startDiscoverySchema)) body: StartDiscoveryInput,
  ) {
    return this.discovery.start(projectId, body);
  }

  @Get("objects")
  inventory(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Query(new ZodPipe(listDiscoveredObjectsQuerySchema)) query: ListDiscoveredObjectsQuery,
  ) {
    return this.discovery.inventory(projectId, query);
  }

  @Get("objects/:objectId")
  getObject(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("objectId", new ParseUUIDPipe()) objectId: string,
  ) {
    return this.discovery.getObject(projectId, objectId);
  }

  @Get("objects/:objectId/dependencies")
  getDependencies(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("objectId", new ParseUUIDPipe()) objectId: string,
  ) {
    return this.discovery.getObjectDependencies(projectId, objectId);
  }
}
