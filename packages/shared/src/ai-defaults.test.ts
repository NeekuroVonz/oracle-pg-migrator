import { describe, expect, test } from "bun:test";
import { AI_KIND_DEFAULTS, defaultAiBaseUrl } from "./ai-defaults";

describe("AI provider defaults", () => {
  test("fills a host per kind and keeps explicit overrides", () => {
    expect(defaultAiBaseUrl("openai")).toBe("https://api.openai.com/v1");
    expect(defaultAiBaseUrl("cursor")).toBe("https://api.cursor.com/v1");
    expect(defaultAiBaseUrl("anthropic")).toBe("https://api.anthropic.com");
    expect(defaultAiBaseUrl("gemini")).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(defaultAiBaseUrl("openai_compatible")).toBe("http://localhost:11434/v1");
    expect(defaultAiBaseUrl("cursor", "https://proxy.example/v1/")).toBe(
      "https://proxy.example/v1",
    );
    expect(AI_KIND_DEFAULTS.cursor.baseUrl).not.toContain("openai.com");
  });
});
