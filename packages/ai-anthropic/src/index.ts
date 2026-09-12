import {
  type CreateMigrationAiProviderInput,
  createMigrationAiProvider,
  type MigrationAIProvider,
} from "@migrator/ai-core";

export function createAnthropicProvider(
  input: Omit<CreateMigrationAiProviderInput, "kind">,
): MigrationAIProvider {
  return createMigrationAiProvider({
    ...input,
    kind: "anthropic",
    baseUrl: input.baseUrl ?? "https://api.anthropic.com",
  });
}
