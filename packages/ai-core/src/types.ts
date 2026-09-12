import type { AiProviderKind, ConversionAttemptStatus, ObjectStatus } from "@migrator/shared";

export type AiConfidence = "low" | "medium" | "high";
export type AiVerifyVerdict = "OK" | "REVIEW_REQUIRED" | "REJECT";
export type AiPromptKind = "converter" | "fixer" | "verifier";

export interface AiProviderRoles {
  convert: boolean;
  fix: boolean;
  verify: boolean;
}

export interface AiConvertInput {
  objectType: string;
  owner: string;
  name: string;
  sourceText: string;
  currentSql?: string | null;
  compileError?: string | null;
  warnings?: string[];
}

export interface AiConvertResult {
  sql: string | null;
  status: ConversionAttemptStatus;
  warnings: string[];
  notes: string | null;
  confidence: AiConfidence;
  promptVersion: string;
}

export interface AiVerifyResult {
  verdict: AiVerifyVerdict;
  reasons: string[];
  promptVersion: string;
}

export interface MigrationAIProvider {
  id: string;
  kind: AiProviderKind;
  name: string;
  model: string;
  capabilities: AiProviderRoles;
  convert(input: AiConvertInput): Promise<AiConvertResult>;
  fix(input: AiConvertInput): Promise<AiConvertResult>;
  verify(input: AiConvertInput): Promise<AiVerifyResult>;
  listModels(): Promise<string[]>;
}

export interface CreateMigrationAiProviderInput {
  id: string;
  kind: AiProviderKind;
  name: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  roles: AiProviderRoles;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CompileStatusInput {
  compilePassed: boolean;
  highRisk: boolean;
  reviewRequired: boolean;
}

export interface TestStatusInput extends CompileStatusInput {
  testsPassed: boolean;
}

export interface VerifyStatusInput extends TestStatusInput {
  verdict: AiVerifyVerdict;
}

export type { ObjectStatus };
