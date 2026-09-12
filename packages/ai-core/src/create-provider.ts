import {
  CURSOR_CLOUD_CHAT_UNSUPPORTED,
  usesCursorAgent,
  type AiProviderKind,
} from "@migrator/shared";
import {
  defaultBaseUrl,
  type FetchLike,
  getJson,
  modelIdsFromList,
  postJson,
  unwrapChatText,
} from "./http";
import { extractJsonObject, normalizeConvertResult, normalizeVerifyResult } from "./parse-json";
import { buildAiUserPayload } from "./payload";
import { loadPrompt, promptVersion } from "./prompts";
import { redactSecrets } from "./redact";
import type {
  AiConvertInput,
  AiConvertResult,
  AiPromptKind,
  AiVerifyResult,
  CreateMigrationAiProviderInput,
  MigrationAIProvider,
} from "./types";

function assertChatCompletionsSupported(kind: AiProviderKind, baseUrl: string): void {
  if (usesCursorAgent(kind, baseUrl)) {
    throw new Error(
      `${CURSOR_CLOUD_CHAT_UNSUPPORTED} Call createCursorProvider from @migrator/ai-cursor.`,
    );
  }
}

async function completeJson(input: {
  kind: AiProviderKind;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
  promptKind: AiPromptKind;
  user: string;
}): Promise<unknown> {
  assertChatCompletionsSupported(input.kind, input.baseUrl);
  const system = redactSecrets(loadPrompt(input.promptKind));
  const user = redactSecrets(input.user);
  if (input.kind === "anthropic") {
    const payload = await postJson({
      url: `${input.baseUrl}/v1/messages`,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: input.model,
        max_tokens: 4096,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      },
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
    });
    return extractJsonObject(unwrapChatText(payload, "anthropic"));
  }
  if (input.kind === "gemini") {
    const payload = await postJson({
      url: `${input.baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`,
      headers: { "x-goog-api-key": input.apiKey },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      },
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
    });
    return extractJsonObject(unwrapChatText(payload, "gemini"));
  }
  const payload = await postJson({
    url: `${input.baseUrl}/chat/completions`,
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: {
      model: input.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  return extractJsonObject(unwrapChatText(payload, input.kind));
}

export function createMigrationAiProvider(
  config: CreateMigrationAiProviderInput,
): MigrationAIProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 60_000;
  const baseUrl = defaultBaseUrl(config.kind, config.baseUrl);
  const version = promptVersion();

  async function convertLike(
    kind: "converter" | "fixer",
    input: AiConvertInput,
  ): Promise<AiConvertResult> {
    const raw = await completeJson({
      kind: config.kind,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl,
      timeoutMs,
      fetchImpl,
      promptKind: kind,
      user: buildAiUserPayload(input),
    });
    return normalizeConvertResult(raw, `${kind}-${version}`);
  }

  return {
    id: config.id,
    kind: config.kind,
    name: config.name,
    model: config.model,
    capabilities: config.roles,
    convert: (input) => convertLike("converter", input),
    fix: (input) => convertLike("fixer", input),
    async verify(input: AiConvertInput): Promise<AiVerifyResult> {
      const raw = await completeJson({
        kind: config.kind,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl,
        timeoutMs,
        fetchImpl,
        promptKind: "verifier",
        user: buildAiUserPayload(input),
      });
      return normalizeVerifyResult(raw, `verifier-${version}`);
    },
    async listModels(): Promise<string[]> {
      assertChatCompletionsSupported(config.kind, baseUrl);
      if (config.kind === "anthropic") {
        const payload = await getJson({
          url: `${baseUrl}/v1/models`,
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": "2023-06-01",
          },
          fetchImpl,
          timeoutMs,
        });
        const ids = modelIdsFromList(payload);
        return ids.length > 0 ? ids : [config.model];
      }
      if (config.kind === "gemini") {
        const payload = await getJson({
          url: `${baseUrl}/models`,
          headers: { "x-goog-api-key": config.apiKey },
          fetchImpl,
          timeoutMs,
        });
        const ids = modelIdsFromList(payload);
        return ids.length > 0 ? ids : [config.model];
      }
      const payload = await getJson({
        url: `${baseUrl}/models`,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        fetchImpl,
        timeoutMs,
      });
      const ids = modelIdsFromList(payload);
      return ids.length > 0 ? ids : [config.model];
    },
  };
}
