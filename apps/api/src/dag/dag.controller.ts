import { type ObjectDagQuery, objectDagQuerySchema } from "@migrator/shared";
import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { DagService } from "./dag.service";

@Controller("api/projects/:projectId")
export class DagController {
  constructor(private readonly dag: DagService) {}

  @Get("dag")
  getProjectDag(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Query(new ZodPipe(objectDagQuerySchema)) query: ObjectDagQuery,
  ) {
    return this.dag.getProjectDag(projectId, query);
  }
}
