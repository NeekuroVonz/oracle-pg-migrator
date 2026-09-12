import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AiConvertInput,
  type AiPromptKind,
  buildAiUserPayload,
  CONVERT_RESULT_SCHEMA,
  createMigrationAiProvider,
  type CreateMigrationAiProviderInput,
  extractJsonObject,
  loadPrompt,
  type MigrationAIProvider,
  normalizeConvertResult,
  normalizeVerifyResult,
  promptVersion,
  redactSecrets,
  VERIFY_RESULT_SCHEMA,
} from "@migrator/ai-core";
import { usesCursorAgent } from "@migrator/shared";

export interface CursorAgentRunResult {
  id?: string;
  status?: string;
  result?: string;
  text?: string;
  error?: { message?: string };
}

export type CursorPromptImpl = (
  message: string,
  options: {
    apiKey: string;
    model: { id: string };
    tools: [];
    local: { cwd: string };
  },
) => Promise<CursorAgentRunResult>;

export type CursorListModelsImpl = () => Promise<string[]>;

export type CreateCursorProviderInput = Omit<CreateMigrationAiProviderInput, "kind"> & {
  promptImpl?: CursorPromptImpl;
  listModelsImpl?: CursorListModelsImpl;
};

function agentPrompt(kind: AiPromptKind, user: string): string {
  const system = redactSecrets(loadPrompt(kind));
  const schema = kind === "verifier" ? VERIFY_RESULT_SCHEMA : CONVERT_RESULT_SCHEMA;
  return (
    `${system}\n\n${user}\n\n` +
    "Return ONLY JSON matching this schema. Do not modify files, " +
    "do not run shell commands, do not connect to databases.\n" +
    schema
  );
}

async function defaultPrompt(
  message: string,
  options: Parameters<CursorPromptImpl>[1],
): Promise<CursorAgentRunResult> {
  const { Agent } = await import("@cursor/sdk");
  return Agent.prompt(message, options);
}

async function defaultListModels(apiKey: string, fallback: string): Promise<string[]> {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  const ids = models.map((model) => model.id).filter(Boolean);
  return ids.length > 0 ? ids : [fallback];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Cursor Agent.prompt timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function runText(run: CursorAgentRunResult): string {
  if (run.status === "error" || run.status === "cancelled") {
    const detail = run.error?.message?.trim() || run.result?.trim() || run.text?.trim() || "";
    const runId = run.id ?? "unknown";
    if (detail) {
      throw new Error(`Cursor agent run failed (run_id=${runId}): ${detail}`);
    }
    throw new Error(
      `Cursor agent run failed (run_id=${runId}). Often caused by oversized prompts or account/model limits.`,
    );
  }
  const text = run.result ?? run.text ?? "";
  if (!text.trim()) {
    throw new Error("Cursor agent returned empty text");
  }
  return text;
}

export function createCursorProvider(input: CreateCursorProviderInput): MigrationAIProvider {
  if (!usesCursorAgent("cursor", input.baseUrl)) {
    return createMigrationAiProvider({ ...input, kind: "cursor" });
  }

  const timeoutMs = input.timeoutMs ?? 60_000;
  const version = promptVersion();
  const promptImpl = input.promptImpl ?? defaultPrompt;

  async function complete(kind: AiPromptKind, convertInput: AiConvertInput): Promise<unknown> {
    const sandbox = await mkdtemp(join(tmpdir(), "migrator-cursor-"));
    try {
      const run = await withTimeout(
        promptImpl(agentPrompt(kind, buildAiUserPayload(convertInput)), {
          apiKey: input.apiKey,
          model: { id: input.model },
          tools: [],
          local: { cwd: sandbox },
        }),
        timeoutMs,
      );
      return extractJsonObject(runText(run));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Cannot find module '@cursor\/sdk'|Failed to resolve/.test(message)) {
        throw new Error(
          "Cursor provider needs @cursor/sdk, or set Base URL to an OpenAI-compatible Chat Completions gateway",
        );
      }
      throw error;
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  }

  return {
    id: input.id,
    kind: "cursor",
    name: input.name,
    model: input.model,
    capabilities: input.roles,
    async convert(convertInput) {
      const raw = await complete("converter", convertInput);
      return normalizeConvertResult(raw, `converter-${version}`);
    },
    async fix(convertInput) {
      const raw = await complete("fixer", convertInput);
      return normalizeConvertResult(raw, `fixer-${version}`);
    },
    async verify(convertInput) {
      const raw = await complete("verifier", convertInput);
      return normalizeVerifyResult(raw, `verifier-${version}`);
    },
    async listModels() {
      if (input.listModelsImpl) {
        return input.listModelsImpl();
      }
      try {
        return await defaultListModels(input.apiKey, input.model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/Cannot find module '@cursor\/sdk'|Failed to resolve/.test(message)) {
          throw new Error(
            "Cursor provider needs @cursor/sdk, or set Base URL to an OpenAI-compatible Chat Completions gateway",
          );
        }
        throw error;
      }
    },
  };
}

export function createRuntimeAiProvider(
  input: CreateMigrationAiProviderInput & {
    promptImpl?: CursorPromptImpl;
    listModelsImpl?: CursorListModelsImpl;
  },
): MigrationAIProvider {
  if (input.kind === "cursor") {
    return createCursorProvider(input);
  }
  return createMigrationAiProvider(input);
}
