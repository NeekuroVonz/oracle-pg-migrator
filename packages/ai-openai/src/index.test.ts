import { describe, expect, test } from "bun:test";
import { createOpenAiProvider } from "./index";

describe("createOpenAiProvider", () => {
  test("uses the OpenAI chat completions URL by default", async () => {
    let url = "";
    const provider = createOpenAiProvider({
      id: "p1",
      name: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      roles: { convert: true, fix: false, verify: false },
      fetchImpl: async (requestUrl) => {
        url = String(requestUrl);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    sql: null,
                    status: "REVIEW_REQUIRED",
                    warnings: [],
                    notes: null,
                    confidence: "low",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await provider.convert({
      objectType: "TABLE",
      owner: "HR",
      name: "EMP",
      sourceText: "CREATE TABLE emp (id NUMBER)",
    });
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });
});
