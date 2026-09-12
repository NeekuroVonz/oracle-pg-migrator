import { describe, expect, test } from "bun:test";
import { createGeminiProvider } from "./index";

describe("createGeminiProvider", () => {
  test("declares gemini kind", () => {
    const provider = createGeminiProvider({
      id: "p1",
      name: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "test",
      roles: { convert: false, fix: false, verify: true },
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    expect(provider.kind).toBe("gemini");
  });
});
