import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_PROMPT_VERSION } from "@migrator/shared";
import type { AiPromptKind } from "./types";

const FALLBACK: Record<AiPromptKind, string> = {
  converter: `You convert Oracle DDL or PL/SQL to PostgreSQL. Return JSON only with sql, status, warnings, notes, confidence. Do not invent business logic. Uncertain conversions are REVIEW_REQUIRED. Never include credentials. You cannot mark VALIDATED.`,
  fixer: `You repair PostgreSQL SQL converted from Oracle that failed to compile. Return JSON only with sql, status, warnings, notes, confidence. Do not invent business logic. Never include credentials. You cannot mark VALIDATED.`,
  verifier: `You review Oracle source versus generated PostgreSQL SQL. Return JSON only with verdict (OK | REVIEW_REQUIRED | REJECT) and reasons. OK does not mean VALIDATED. Never include credentials.`,
};

function promptsRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..", "prompts");
}

export function promptVersion(): string {
  return AI_PROMPT_VERSION;
}

export function loadPrompt(kind: AiPromptKind, version = AI_PROMPT_VERSION): string {
  const folder = kind === "converter" ? "converter" : kind === "fixer" ? "fixer" : "verifier";
  const file = join(promptsRoot(), folder, `${version}.md`);
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return FALLBACK[kind];
  }
}
