import { describe, expect, test } from "bun:test";
import { createOpenAiCompatibleProvider } from "./index";

describe("createOpenAiCompatibleProvider", () => {
  test("requires a base URL", () => {
    expect(() =>
      createOpenAiCompatibleProvider({
        id: "p1",
        name: "ollama",
        model: "llama3.1",
        apiKey: "none",
        roles: { convert: true, fix: true, verify: false },
      }),
    ).toThrow("base URL");
  });
});
