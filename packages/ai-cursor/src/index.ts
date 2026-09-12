import {
  type CreateMigrationAiProviderInput,
  createMigrationAiProvider,
  type MigrationAIProvider,
} from "@migrator/ai-core";

export function createCursorProvider(
  input: Omit<CreateMigrationAiProviderInput, "kind">,
): MigrationAIProvider {
  return createMigrationAiProvider({
    ...input,
    kind: "cursor",
  });
}
