import { type AiProviderKind, defaultAiBaseUrl } from "@migrator/shared";
import { redactErrorMessage, redactSecrets } from "./redact";

export type FetchLike = typeof fetch;

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function defaultBaseUrl(kind: AiProviderKind, baseUrl?: string | null): string {
  return defaultAiBaseUrl(kind, baseUrl);
}

async function readErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return redactSecrets(text).slice(0, 400);
}

export async function postJson(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<unknown> {
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...input.headers,
    },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`AI provider HTTP ${response.status}: ${detail}`);
  }
  return (await response.json()) as unknown;
}

export async function getJson(input: {
  url: string;
  headers: Record<string, string>;
  fetchImpl: FetchLike;
  timeoutMs: number;
}): Promise<unknown> {
  const response = await input.fetchImpl(input.url, {
    method: "GET",
    headers: input.headers,
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new Error(`AI provider HTTP ${response.status}: ${detail}`);
  }
  return (await response.json()) as unknown;
}

export function unwrapChatText(payload: unknown, kind: string): string {
  if (!payload || typeof payload !== "object") {
    throw new Error(`${kind} returned an empty response`);
  }
  const record = payload as Record<string, unknown>;
  if (kind === "anthropic") {
    const content = record.content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : "",
        )
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }
  if (kind === "gemini") {
    const candidates = record.candidates;
    if (Array.isArray(candidates)) {
      const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined;
      const text = first?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }
  const choices = record.choices;
  if (Array.isArray(choices)) {
    const message = choices[0] as { message?: { content?: unknown } } | undefined;
    const content = message?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content;
    }
  }
  throw new Error(
    `${kind} response did not include text: ${redactErrorMessage(JSON.stringify(record).slice(0, 200))}`,
  );
}

export function modelIdsFromList(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data)) {
    return data
      .map((item) =>
        item && typeof item === "object" && "id" in item
          ? String((item as { id: unknown }).id)
          : "",
      )
      .filter(Boolean);
  }
  const models = record.models;
  if (Array.isArray(models)) {
    return models
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "name" in item) {
          return String((item as { name: unknown }).name).replace(/^models\//, "");
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}
