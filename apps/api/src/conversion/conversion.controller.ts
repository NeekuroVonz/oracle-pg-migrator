import {
  type ListConversionRunObjectsQuery,
  type ListConversionRunsQuery,
  listConversionRunObjectsQuerySchema,
  listConversionRunsQuerySchema,
  type StartConversionInput,
  type StartDataCopyInput,
  type StartDeployInput,
  startConversionSchema,
  startDataCopySchema,
  startDeploySchema,
} from "@migrator/shared";
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { DagService } from "../dag/dag.service";
import { DataCopyService } from "../data-copy/data-copy.service";
import { DeployService } from "../deploy/deploy.service";
import { ReportService } from "../report/report.service";
import { ConversionService } from "./conversion.service";

@Controller("api/projects/:projectId/runs")
export class ConversionController {
  constructor(
    private readonly conversion: ConversionService,
    private readonly dag: DagService,
    private readonly reports: ReportService,
    private readonly dataCopy: DataCopyService,
    private readonly deploy: DeployService,
  ) {}

  @Get()
  list(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Query(new ZodPipe(listConversionRunsQuerySchema)) _query: ListConversionRunsQuery,
  ) {
    return this.conversion.list(projectId);
  }

  @Post()
  start(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Body(new ZodPipe(startConversionSchema)) body: StartConversionInput,
  ) {
    return this.conversion.start(projectId, body);
  }

  @Post(":runId/stop")
  stop(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.conversion.stop(projectId, runId);
  }

  @Get(":runId/report/sql")
  getReportSql(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.reports.getSql(projectId, runId);
  }

  @Post(":runId/data-copy")
  startDataCopy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
    @Body(new ZodPipe(startDataCopySchema)) body: StartDataCopyInput,
  ) {
    return this.dataCopy.start(projectId, runId, body);
  }

  @Post(":runId/data-copy/resume-failed")
  resumeFailedDataCopy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.dataCopy.resumeFailed(projectId, runId);
  }

  @Post(":runId/data-copy/pause")
  pauseDataCopy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.dataCopy.pause(projectId, runId);
  }

  @Get(":runId/data-copy")
  getDataCopy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.dataCopy.getLatest(projectId, runId);
  }

  @Post(":runId/deploy")
  startDeploy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
    @Body(new ZodPipe(startDeploySchema)) body: StartDeployInput,
  ) {
    return this.deploy.start(projectId, runId, body);
  }

  @Get(":runId/deploy")
  getDeploy(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.deploy.getLatest(projectId, runId);
  }

  @Get(":runId/report")
  getReport(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.reports.get(projectId, runId);
  }

  @Get(":runId/dag")
  getDag(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
  ) {
    return this.dag.getRunDag(projectId, runId);
  }

  @Get(":runId")
  get(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
    @Query(new ZodPipe(listConversionRunObjectsQuerySchema)) query: ListConversionRunObjectsQuery,
  ) {
    return this.conversion.get(projectId, runId, query);
  }

  @Get(":runId/objects/:objectId")
  getObject(
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Param("runId", new ParseUUIDPipe()) runId: string,
    @Param("objectId", new ParseUUIDPipe()) objectId: string,
  ) {
    return this.conversion.getObject(projectId, runId, objectId);
  }
}
