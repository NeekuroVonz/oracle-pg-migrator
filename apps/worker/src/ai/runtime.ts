import {
  createAiRegistry,
  type MigrationAIProvider,
} from "@migrator/ai-core";
import { createRuntimeAiProvider } from "@migrator/ai-cursor";
import type { AppEnv, SecretCipher } from "@migrator/config";
import type { AiProvidersRepository } from "@migrator/db";

export interface AiRuntime {
  convert: MigrationAIProvider | undefined;
  fix: MigrationAIProvider | undefined;
  verify: MigrationAIProvider | undefined;
  maxAttempts: number;
}

export async function loadAiRuntime(input: {
  env: AppEnv;
  providers: AiProvidersRepository;
  cipher: SecretCipher;
}): Promise<AiRuntime> {
  const rows = await input.providers.listEnabled();
  const instances: MigrationAIProvider[] = rows.map((row) =>
    createRuntimeAiProvider({
      id: row.id,
      kind: row.kind,
      name: row.name,
      model: row.model,
      apiKey: input.cipher.decrypt(row.apiKeyCiphertext),
      baseUrl: row.baseUrl,
      roles: {
        convert: row.roleConvert,
        fix: row.roleFix,
        verify: row.roleVerify,
      },
      timeoutMs: input.env.AI_TIMEOUT_MS,
    }),
  );
  if (instances.length === 0 && input.env.AI_OPENAI_API_KEY) {
    instances.push(
      createRuntimeAiProvider({
        id: "env-openai",
        kind: "openai",
        name: "OpenAI (env)",
        model: input.env.AI_OPENAI_MODEL,
        apiKey: input.env.AI_OPENAI_API_KEY,
        baseUrl: input.env.AI_OPENAI_BASE_URL,
        roles: { convert: true, fix: true, verify: true },
        timeoutMs: input.env.AI_TIMEOUT_MS,
      }),
    );
  }
  const registry = createAiRegistry(instances);
  return {
    convert: registry.forRole("convert"),
    fix: registry.forRole("fix"),
    verify: registry.forRole("verify"),
    maxAttempts: input.env.AI_MAX_ATTEMPTS,
  };
}
