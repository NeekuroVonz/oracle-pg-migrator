import { describe, expect, test } from "bun:test";
import { createMigrationAiProvider } from "./create-provider";

describe("createMigrationAiProvider", () => {
  test("OpenAI-compatible requests keep the key in the header and redact prompt secrets", async () => {
    let captured: { url: string; body: string; auth: string | null } | undefined;
    const provider = createMigrationAiProvider({
      id: "p1",
      kind: "openai",
      name: "test",
      model: "gpt-4o-mini",
      apiKey: "sk-test-secret-key",
      roles: { convert: true, fix: true, verify: true },
      fetchImpl: async (url, init) => {
        captured = {
          url: String(url),
          body: String(init?.body ?? ""),
          auth: new Headers(init?.headers).get("Authorization"),
        };
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sql: "CREATE TABLE t (id int);",
                    status: "SUCCEEDED",
                    warnings: [],
                    notes: null,
                    confidence: "high",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    const result = await provider.convert({
      objectType: "TABLE",
      owner: "HR",
      name: "EMP",
      sourceText: "CREATE TABLE emp (id NUMBER); password=hunter2",
    });
    expect(result.sql).toContain("CREATE TABLE");
    expect(captured?.auth).toBe("Bearer sk-test-secret-key");
    expect(captured?.body).not.toContain("hunter2");
    expect(captured?.body).toContain("[REDACTED]");
    expect(captured?.body).not.toContain("sk-test-secret-key");
    expect(captured?.url).toContain("/chat/completions");
  });

  test("verifier JSON is accepted without a VALIDATED field", async () => {
    const provider = createMigrationAiProvider({
      id: "p1",
      kind: "openai",
      name: "test",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      roles: { convert: false, fix: false, verify: true },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "OK",
                    reasons: [],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const result = await provider.verify({
      objectType: "TABLE",
      owner: "HR",
      name: "EMP",
      sourceText: "CREATE TABLE emp (id NUMBER)",
      currentSql: "CREATE TABLE emp (id bigint);",
    });
    expect(result.verdict).toBe("OK");
    expect(JSON.stringify(result)).not.toContain("VALIDATED");
  });
});
