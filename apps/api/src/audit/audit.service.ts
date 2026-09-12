import { AuditRepository } from "@migrator/db";
import { Injectable } from "@nestjs/common";

@Injectable()
export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  list(projectId: string) {
    return this.audit.listByProject(projectId);
  }
}
