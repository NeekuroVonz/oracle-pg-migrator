import { Controller, Get } from "@nestjs/common";
import { ValidatorPoolService } from "./validator-pool.service";

@Controller("api/validator-pool")
export class ValidatorPoolController {
  constructor(private readonly pool: ValidatorPoolService) {}

  @Get()
  status() {
    return this.pool.status();
  }
}
