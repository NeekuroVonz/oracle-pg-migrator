import type { AppEnv } from "@migrator/config";
import { pingDatabase } from "@migrator/db";
import { pingRedis } from "@migrator/queue";
import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";

@Injectable()
export class HealthService {
  constructor(
    private readonly pool: Pool,
    private readonly env: AppEnv,
  ) {}

  liveness() {
    return { status: "ok", service: "api" };
  }

  async readiness() {
    const database = await pingDatabase(this.pool);
    const redis = await pingRedis(this.env.REDIS_URL);
    const ready = database && redis;
    return {
      status: ready ? "ok" : "degraded",
      database,
      redis,
    };
  }
}
