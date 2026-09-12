import type { AppEnv } from "@migrator/config";
import { inspectValidatorPool } from "@migrator/docker-manager";
import { Injectable } from "@nestjs/common";

@Injectable()
export class ValidatorPoolService {
  constructor(private readonly env: AppEnv) {}

  status() {
    return inspectValidatorPool({
      mode: this.env.VALIDATOR_MODE,
      size: this.env.VALIDATOR_POOL_SIZE,
      databaseUrl: this.env.VALIDATOR_DATABASE_URL,
      dockerImage: this.env.VALIDATOR_DOCKER_IMAGE,
      statementTimeoutMs: this.env.VALIDATOR_STATEMENT_TIMEOUT_MS,
    });
  }
}
