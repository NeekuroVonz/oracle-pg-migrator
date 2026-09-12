import { z } from "zod";
import type { AiConvertResult, AiVerifyResult } from "./types";

const convertSchema = z.object({
  sql: z.string().nullable().optional(),
  status: z.enum(["SUCCEEDED", "FAILED", "REVIEW_REQUIRED"]).optional(),
  warnings: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});

const verifySchema = z.object({
  verdict: z.enum(["OK", "REVIEW_REQUIRED", "REJECT"]),
  reasons: z.array(z.string()).optional(),
});

export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI response did not contain a JSON object");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

export function normalizeConvertResult(raw: unknown, promptVersion: string): AiConvertResult {
  const parsed = convertSchema.parse(raw);
  const sql = parsed.sql?.trim() ? parsed.sql.trim() : null;
  let status = parsed.status ?? (sql ? "SUCCEEDED" : "REVIEW_REQUIRED");
  const confidence = parsed.confidence ?? "medium";
  const warnings = [...(parsed.warnings ?? [])];
  if (status === "SUCCEEDED" && !sql) {
    status = "REVIEW_REQUIRED";
    warnings.push("AI claimed success without SQL");
  }
  if (confidence === "low" && status === "SUCCEEDED") {
    status = "REVIEW_REQUIRED";
    warnings.push("Low confidence conversion requires review");
  }
  return {
    sql,
    status,
    warnings,
    notes: parsed.notes ?? null,
    confidence,
    promptVersion,
  };
}

export function normalizeVerifyResult(raw: unknown, promptVersion: string): AiVerifyResult {
  const parsed = verifySchema.parse(raw);
  return {
    verdict: parsed.verdict,
    reasons: parsed.reasons ?? [],
    promptVersion,
  };
}
