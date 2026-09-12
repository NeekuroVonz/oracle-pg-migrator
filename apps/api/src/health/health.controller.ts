import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("health")
  liveness() {
    return this.health.liveness();
  }

  @Get("ready")
  ready() {
    return this.health.readiness();
  }
}
