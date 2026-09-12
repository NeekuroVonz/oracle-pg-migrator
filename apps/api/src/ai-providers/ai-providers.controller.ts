import {
  type CreateAiProviderInput,
  createAiProviderSchema,
  type UpdateAiProviderInput,
  updateAiProviderSchema,
} from "@migrator/shared";
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod-pipe";
import { AiProvidersService } from "./ai-providers.service";

@Controller("api/ai-providers")
export class AiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Get()
  list() {
    return this.providers.list();
  }

  @Post()
  create(@Body(new ZodPipe(createAiProviderSchema)) body: CreateAiProviderInput) {
    return this.providers.create(body);
  }

  @Patch(":providerId")
  update(
    @Param("providerId", new ParseUUIDPipe()) providerId: string,
    @Body(new ZodPipe(updateAiProviderSchema)) body: UpdateAiProviderInput,
  ) {
    return this.providers.update(providerId, body);
  }

  @Delete(":providerId")
  async remove(@Param("providerId", new ParseUUIDPipe()) providerId: string) {
    await this.providers.delete(providerId);
    return { ok: true };
  }

  @Post(":providerId/test")
  test(@Param("providerId", new ParseUUIDPipe()) providerId: string) {
    return this.providers.test(providerId);
  }
}
