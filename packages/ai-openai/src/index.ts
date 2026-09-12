import {
  type CreateMigrationAiProviderInput,
  createMigrationAiProvider,
  type MigrationAIProvider,
} from "@migrator/ai-core";

export function createOpenAiProvider(
  input: Omit<CreateMigrationAiProviderInput, "kind">,
): MigrationAIProvider {
  return createMigrationAiProvider({
    ...input,
    kind: "openai",
    baseUrl: input.baseUrl ?? "https://api.openai.com/v1",
  });
}
