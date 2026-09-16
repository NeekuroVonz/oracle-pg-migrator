import {
  type IncludeScopeObjectsInput,
  includeScopeObjectsSchema,
  type ScopePreviewQuery,
  scopePreviewQuerySchema,
  type UpsertScopeInput,
  upsertScopeSchema,
} from "@migrator/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { ScopeService } from "./scope.service";

@Controller("api/projects/:projectId/scope")
export class ScopeController {
  constructor(private readonly scope: ScopeService) {}

  @Get()
  get(@Param("projectId", new ParseUUIDPipe()) projectId: string) {
    return this.scope.get(projectId);
  }

  @Put()
  upsert(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(upsertScopeSchema)) body: UpsertScopeInput,
  ) {
    return this.scope.upsert(projectId, body);
  }

  @Post("include-objects")
  includeObjects(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(includeScopeObjectsSchema)) body: IncludeScopeObjectsInput,
  ) {
    return this.scope.includeObjects(projectId, body);
  }

  @Post("preview")
  preview(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(upsertScopeSchema)) body: UpsertScopeInput,
    @Query(new ZodPipe(scopePreviewQuerySchema)) query: ScopePreviewQuery,
  ) {
    return this.scope.preview(projectId, body, query);
  }
}
