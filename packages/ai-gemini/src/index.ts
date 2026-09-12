import {
  type CreateMigrationAiProviderInput,
  createMigrationAiProvider,
  type MigrationAIProvider,
} from "@migrator/ai-core";

export function createGeminiProvider(
  input: Omit<CreateMigrationAiProviderInput, "kind">,
): MigrationAIProvider {
  return createMigrationAiProvider({
    ...input,
    kind: "gemini",
    baseUrl: input.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta",
  });
}
