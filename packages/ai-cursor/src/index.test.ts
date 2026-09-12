import { describe, expect, test } from "bun:test";
import { createCursorProvider, createRuntimeAiProvider } from "./index";

describe("createCursorProvider", () => {
  test("declares cursor kind", () => {
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor",
      model: "composer-2.5",
      apiKey: "test",
      roles: { convert: true, fix: true, verify: true },
      promptImpl: async () => ({ status: "finished", result: "{}" }),
    });
    expect(provider.kind).toBe("cursor");
  });

  test("uses Agent.prompt instead of chat completions on api.cursor.com", async () => {
    let cwd = "";
    let tools: unknown;
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor",
      model: "composer-2.5",
      apiKey: "crsr-test",
      roles: { convert: true, fix: true, verify: true },
      promptImpl: async (message, options) => {
        cwd = options.local.cwd;
        tools = options.tools;
        expect(message).toContain("Return ONLY JSON");
        expect(message).not.toContain("hunter2");
        expect(options.model.id).toBe("composer-2.5");
        expect(options.apiKey).toBe("crsr-test");
        return {
          status: "finished",
          result: JSON.stringify({
            sql: "CREATE TABLE emp (id bigint);",
            status: "SUCCEEDED",
            warnings: [],
            notes: null,
            confidence: "high",
          }),
        };
      },
    });
    const result = await provider.convert({
      objectType: "TABLE",
      owner: "HR",
      name: "EMP",
      sourceText: "CREATE TABLE emp (id NUMBER); password=hunter2",
    });
    expect(result.sql).toContain("CREATE TABLE emp");
    expect(tools).toEqual([]);
    expect(cwd).toContain("migrator-cursor-");
  });

  test("surfaces a failed Cursor agent run", async () => {
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor",
      model: "composer-2.5",
      apiKey: "crsr-test",
      roles: { convert: true, fix: true, verify: true },
      promptImpl: async () => ({
        id: "run-1",
        status: "error",
        result: "account limit",
      }),
    });
    await expect(
      provider.fix({
        objectType: "TABLE",
        owner: "HR",
        name: "EMP",
        sourceText: "CREATE TABLE emp (id NUMBER)",
        currentSql: "CREATE TABLE emp (id bigint);",
        compileError: "syntax error",
      }),
    ).rejects.toThrow(/run_id=run-1/);
  });

  test("still calls a Cursor-compatible Chat Completions proxy", async () => {
    let url = "";
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor-proxy",
      model: "gpt-4o-mini",
      apiKey: "crsr-test",
      baseUrl: "https://proxy.example/v1",
      roles: { convert: true, fix: true, verify: true },
      fetchImpl: async (requestUrl) => {
        url = String(requestUrl);
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    await provider.listModels();
    expect(url).toBe("https://proxy.example/v1/models");
  });
});

describe("createRuntimeAiProvider", () => {
  test("routes cursor to the Agent.prompt adapter", async () => {
    const provider = createRuntimeAiProvider({
      id: "p1",
      kind: "cursor",
      name: "cursor",
      model: "composer-2.5",
      apiKey: "crsr-test",
      roles: { convert: false, fix: false, verify: true },
      promptImpl: async () => ({
        status: "finished",
        result: JSON.stringify({ verdict: "OK", reasons: [] }),
      }),
    });
    const result = await provider.verify({
      objectType: "TABLE",
      owner: "HR",
      name: "EMP",
      sourceText: "CREATE TABLE emp (id NUMBER)",
      currentSql: "CREATE TABLE emp (id bigint);",
    });
    expect(result.verdict).toBe("OK");
  });
});
