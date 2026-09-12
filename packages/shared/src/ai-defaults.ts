import type { AiProviderKind } from "./enums";

export const AI_KIND_DEFAULTS: Record<AiProviderKind, { model: string; baseUrl: string }> = {
  openai: {
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    model: "claude-3-5-haiku-latest",
    baseUrl: "https://api.anthropic.com",
  },
  gemini: {
    model: "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  cursor: {
    model: "composer-2.5",
    baseUrl: "https://api.cursor.com/v1",
  },
  openai_compatible: {
    model: "llama3.1",
    baseUrl: "http://localhost:11434/v1",
  },
};

export function defaultAiBaseUrl(kind: AiProviderKind, override?: string | null): string {
  const trimmed = override?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }
  return AI_KIND_DEFAULTS[kind].baseUrl;
}

export const CURSOR_CLOUD_CHAT_UNSUPPORTED =
  "Cursor Cloud API (api.cursor.com) has no POST /v1/chat/completions. Use @migrator/ai-cursor Agent.prompt, or point Base URL at an OpenAI-compatible proxy.";

export function isCursorCloudApiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === "api.cursor.com";
  } catch {
    return /api\.cursor\.com/i.test(baseUrl);
  }
}

export function usesCursorAgent(kind: AiProviderKind, baseUrl?: string | null): boolean {
  if (kind !== "cursor") {
    return false;
  }
  return isCursorCloudApiHost(defaultAiBaseUrl("cursor", baseUrl));
}
