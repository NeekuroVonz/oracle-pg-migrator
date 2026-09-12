import { describe, expect, test } from "bun:test";
import { createCursorProvider } from "./index";

describe("createCursorProvider", () => {
  test("declares cursor kind", () => {
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor",
      model: "gpt-4o-mini",
      apiKey: "test",
      roles: { convert: true, fix: true, verify: true },
      fetchImpl: async () => new Response("{}", { status: 500 }),
    });
    expect(provider.kind).toBe("cursor");
  });

  test("calls the Cursor API host by default", async () => {
    let url = "";
    const provider = createCursorProvider({
      id: "p1",
      name: "cursor",
      model: "gpt-4o-mini",
      apiKey: "crsr-test",
      roles: { convert: true, fix: true, verify: true },
      fetchImpl: async (requestUrl) => {
        url = String(requestUrl);
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    });
    await provider.listModels();
    expect(url).toBe("https://api.cursor.com/v1/models");
  });
});
