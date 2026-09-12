import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { AuditService } from "./audit.service";

@Controller("api/projects/:projectId/audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Param("projectId", new ParseUUIDPipe()) projectId: string) {
    return this.audit.list(projectId);
  }
}
