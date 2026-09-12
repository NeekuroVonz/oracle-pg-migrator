import { type MigrationAIProvider, redactErrorMessage } from "@migrator/ai-core";
import { createRuntimeAiProvider } from "@migrator/ai-cursor";
import type { AppEnv, SecretCipher } from "@migrator/config";
import { AiProvidersRepository, AuditRepository, toAiProviderDto } from "@migrator/db";
import type {
  AiProviderDto,
  AiProviderTestResult,
  CreateAiProviderInput,
  UpdateAiProviderInput,
} from "@migrator/shared";
import { Injectable } from "@nestjs/common";

@Injectable()
export class AiProvidersService {
  constructor(
    private readonly env: AppEnv,
    private readonly providers: AiProvidersRepository,
    private readonly audit: AuditRepository,
    private readonly cipher: SecretCipher,
  ) {}

  async list(): Promise<AiProviderDto[]> {
    const rows = await this.providers.list();
    return rows.map(toAiProviderDto);
  }

  async create(input: CreateAiProviderInput): Promise<AiProviderDto> {
    const row = await this.providers.create({
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl || null,
      model: input.model,
      apiKeyCiphertext: this.cipher.encrypt(input.apiKey),
      enabled: input.enabled,
      roleConvert: input.roleConvert,
      roleFix: input.roleFix,
      roleVerify: input.roleVerify,
    });
    await this.audit.append({
      action: "ai_provider.created",
      entityType: "ai_provider",
      entityId: row.id,
      metadata: { kind: row.kind, name: row.name },
    });
    return toAiProviderDto(row);
  }

  async update(id: string, input: UpdateAiProviderInput): Promise<AiProviderDto> {
    const patch: Parameters<AiProvidersRepository["update"]>[1] = {};
    if (input.name !== undefined) {
      patch.name = input.name;
    }
    if (input.kind !== undefined) {
      patch.kind = input.kind;
    }
    if (input.baseUrl !== undefined) {
      patch.baseUrl = input.baseUrl;
    }
    if (input.model !== undefined) {
      patch.model = input.model;
    }
    if (input.apiKey !== undefined) {
      patch.apiKeyCiphertext = this.cipher.encrypt(input.apiKey);
    }
    if (input.enabled !== undefined) {
      patch.enabled = input.enabled;
    }
    if (input.roleConvert !== undefined) {
      patch.roleConvert = input.roleConvert;
    }
    if (input.roleFix !== undefined) {
      patch.roleFix = input.roleFix;
    }
    if (input.roleVerify !== undefined) {
      patch.roleVerify = input.roleVerify;
    }
    const row = await this.providers.update(id, patch);
    await this.audit.append({
      action: "ai_provider.updated",
      entityType: "ai_provider",
      entityId: row.id,
      metadata: { kind: row.kind, name: row.name },
    });
    return toAiProviderDto(row);
  }

  async delete(id: string): Promise<void> {
    await this.providers.delete(id);
    await this.audit.append({
      action: "ai_provider.deleted",
      entityType: "ai_provider",
      entityId: id,
      metadata: {},
    });
  }

  async test(id: string): Promise<AiProviderTestResult> {
    const row = await this.providers.getByIdOrThrow(id);
    const apiKey = this.cipher.decrypt(row.apiKeyCiphertext);
    const provider = this.toRuntime(row, apiKey);
    try {
      const models = await provider.listModels();
      await this.providers.update(id, {
        lastTestedAt: new Date(),
        lastTestStatus: "ok",
      });
      await this.audit.append({
        action: "ai_provider.tested",
        entityType: "ai_provider",
        entityId: id,
        metadata: { ok: true, modelCount: models.length },
      });
      return { ok: true, models: models.slice(0, 25), message: "Provider reachable" };
    } catch (error) {
      const message = redactErrorMessage(error);
      await this.providers.update(id, {
        lastTestedAt: new Date(),
        lastTestStatus: "failed",
      });
      await this.audit.append({
        action: "ai_provider.tested",
        entityType: "ai_provider",
        entityId: id,
        metadata: { ok: false },
      });
      return { ok: false, models: [], message };
    }
  }

  private toRuntime(
    row: Awaited<ReturnType<AiProvidersRepository["getByIdOrThrow"]>>,
    apiKey: string,
  ): MigrationAIProvider {
    return createRuntimeAiProvider({
      id: row.id,
      kind: row.kind,
      name: row.name,
      model: row.model,
      apiKey,
      baseUrl: row.baseUrl,
      roles: {
        convert: row.roleConvert,
        fix: row.roleFix,
        verify: row.roleVerify,
      },
      timeoutMs: this.env.AI_TIMEOUT_MS,
    });
  }
}
