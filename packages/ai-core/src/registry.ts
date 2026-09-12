import type { AiProviderRole } from "@migrator/shared";
import type { MigrationAIProvider } from "./types";

export function providerForRole(
  providers: MigrationAIProvider[],
  role: AiProviderRole,
): MigrationAIProvider | undefined {
  return providers.find((provider) => provider.capabilities[role]);
}

export function createAiRegistry(providers: MigrationAIProvider[]) {
  return {
    providers,
    forRole(role: AiProviderRole): MigrationAIProvider | undefined {
      return providerForRole(providers, role);
    },
  };
}
