import { describe, expect, test } from "bun:test";
import { createAnthropicProvider } from "./index";

describe("createAnthropicProvider", () => {
  test("declares anthropic kind", () => {
    const provider = createAnthropicProvider({
      id: "p1",
      name: "anthropic",
      model: "claude-3-5-haiku-latest",
      apiKey: "sk-ant-test",
      roles: { convert: false, fix: true, verify: false },
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    expect(provider.kind).toBe("anthropic");
  });
});
