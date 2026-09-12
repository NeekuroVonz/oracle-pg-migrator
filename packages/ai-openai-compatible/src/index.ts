import {
  type CreateMigrationAiProviderInput,
  createMigrationAiProvider,
  type MigrationAIProvider,
} from "@migrator/ai-core";

export function createOpenAiCompatibleProvider(
  input: Omit<CreateMigrationAiProviderInput, "kind">,
): MigrationAIProvider {
  if (!input.baseUrl) {
    throw new Error("OpenAI-compatible providers require a base URL");
  }
  return createMigrationAiProvider({
    ...input,
    kind: "openai_compatible",
  });
}
