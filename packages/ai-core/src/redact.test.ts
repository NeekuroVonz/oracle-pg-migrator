import { describe, expect, test } from "bun:test";
import { extractJsonObject, normalizeConvertResult } from "./parse-json";
import { formatAiHttpError } from "./http";
import { redactSecrets } from "./redact";
import { createAiRegistry } from "./registry";
import {
  objectStatusAfterAiExhausted,
  objectStatusAfterCompile,
  objectStatusAfterTests,
  objectStatusAfterVerify,
} from "./status";
import type { MigrationAIProvider } from "./types";

describe("redactSecrets", () => {
  test("strips passwords, URIs, and API keys", () => {
    const input = [
      "password=hunter2",
      "postgres://migrator:secret@localhost:5433/migrator",
      "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz",
      "sk-ant-abc1234567",
      "v1:abc:def:ghi",
      "SECRETS_MASTER_KEY present",
    ].join("\n");
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("secret@");
    expect(redacted).not.toContain("sk-live-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("sk-ant-abc1234567");
    expect(redacted).not.toContain("v1:abc:def:ghi");
    expect(redacted).toContain("[REDACTED]");
  });
});

describe("extractJsonObject", () => {
  test("parses fenced JSON", () => {
    const parsed = extractJsonObject(
      'notes\n```json\n{"sql":"select 1","status":"SUCCEEDED"}\n```',
    );
    expect(parsed).toEqual({ sql: "select 1", status: "SUCCEEDED" });
  });
});

describe("normalizeConvertResult", () => {
  test("empty SQL cannot succeed", () => {
    const result = normalizeConvertResult({ sql: null, status: "SUCCEEDED" }, "v1");
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  test("low confidence requires review", () => {
    const result = normalizeConvertResult(
      { sql: "CREATE TABLE t (id int);", status: "SUCCEEDED", confidence: "low" },
      "v1",
    );
    expect(result.status).toBe("REVIEW_REQUIRED");
  });
});

describe("object status", () => {
  test("compile alone is not VALIDATED; tests and verifier cannot upgrade high-risk", () => {
    expect(
      objectStatusAfterCompile({ compilePassed: true, highRisk: false, reviewRequired: false }),
    ).toBe("TESTING");
    expect(
      objectStatusAfterTests({
        compilePassed: true,
        testsPassed: true,
        highRisk: false,
        reviewRequired: false,
      }),
    ).toBe("VALIDATED");
    expect(
      objectStatusAfterTests({
        compilePassed: true,
        testsPassed: false,
        highRisk: false,
        reviewRequired: false,
      }),
    ).toBe("REVIEW_REQUIRED");
    expect(
      objectStatusAfterVerify({
        compilePassed: true,
        testsPassed: true,
        highRisk: true,
        reviewRequired: false,
        verdict: "OK",
      }),
    ).toBe("REVIEW_REQUIRED");
    expect(
      objectStatusAfterVerify({
        compilePassed: true,
        testsPassed: true,
        highRisk: false,
        reviewRequired: false,
        verdict: "REJECT",
      }),
    ).toBe("REVIEW_REQUIRED");
    expect(
      objectStatusAfterVerify({
        compilePassed: true,
        testsPassed: false,
        highRisk: false,
        reviewRequired: false,
        verdict: "OK",
      }),
    ).not.toBe("VALIDATED");
    expect(objectStatusAfterAiExhausted()).toBe("REVIEW_REQUIRED");
  });

  test("skipped tests cannot become VALIDATED via verify OK", () => {
    expect(
      objectStatusAfterVerify({
        compilePassed: true,
        testsPassed: false,
        highRisk: false,
        reviewRequired: false,
        verdict: "OK",
      }),
    ).toBe("REVIEW_REQUIRED");
  });
});

describe("registry", () => {
  test("picks the first provider that can fix", () => {
    const convertOnly = {
      id: "a",
      capabilities: { convert: true, fix: false, verify: false },
    } as MigrationAIProvider;
    const fixer = {
      id: "b",
      capabilities: { convert: false, fix: true, verify: false },
    } as MigrationAIProvider;
    const registry = createAiRegistry([convertOnly, fixer]);
    expect(registry.forRole("fix")?.id).toBe("b");
  });
});

describe("formatAiHttpError", () => {
  test("explains a missing chat completions route", () => {
    const message = formatAiHttpError(
      404,
      "https://api.cursor.com/v1/chat/completions",
      '{"message":"Route POST:/v1/chat/completions not found"}',
    );
    expect(message).toContain("AI provider HTTP 404");
    expect(message).toContain("no OpenAI Chat Completions route");
  });
});
