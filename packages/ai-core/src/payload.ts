import type { AiConvertInput } from "./types";
import { redactSecrets } from "./redact";

export function buildAiUserPayload(input: AiConvertInput): string {
  return redactSecrets(
    JSON.stringify({
      objectType: input.objectType,
      owner: input.owner,
      name: input.name,
      oracleSource: input.sourceText,
      currentSql: input.currentSql ?? null,
      compileError: input.compileError ?? null,
      warnings: input.warnings ?? [],
    }),
  );
}

export const CONVERT_RESULT_SCHEMA = `{
  "sql": "string or null",
  "status": "SUCCEEDED | FAILED | REVIEW_REQUIRED",
  "warnings": ["string"],
  "notes": "string or null",
  "confidence": "low | medium | high"
}`;

export const VERIFY_RESULT_SCHEMA = `{
  "verdict": "OK | REVIEW_REQUIRED | REJECT",
  "reasons": ["string"]
}`;
