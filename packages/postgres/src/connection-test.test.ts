import { describe, expect, test } from "bun:test";
import { postgresSslOption, testPostgresConnection } from "./connection-test";

describe("postgres ssl mapping", () => {
  test("covers every ssl mode", () => {
    expect(postgresSslOption("disable")).toBe(false);
    expect(postgresSslOption("prefer")).toBeUndefined();
    expect(postgresSslOption("require")).toEqual({ rejectUnauthorized: false });
    expect(postgresSslOption("verify-ca")).toEqual({ rejectUnauthorized: true });
    expect(postgresSslOption("verify-full")).toEqual({ rejectUnauthorized: true });
  });
});

describe("testPostgresConnection", () => {
  test("returns ok:false when the host refuses the connection", async () => {
    const result = await testPostgresConnection({
      host: "127.0.0.1",
      port: 1,
      database: "migrator",
      username: "migrator",
      password: "migrator",
      sslMode: "disable",
      connectionTimeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.engine).toBe("POSTGRESQL");
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("postgres ssl mapping", () => {
  test("covers every ssl mode", () => {
    expect(postgresSslOption("disable")).toBe(false);
    expect(postgresSslOption("prefer")).toBeUndefined();
    expect(postgresSslOption("require")).toEqual({ rejectUnauthorized: false });
    expect(postgresSslOption("verify-ca")).toEqual({ rejectUnauthorized: true });
    expect(postgresSslOption("verify-full")).toEqual({ rejectUnauthorized: true });
  });
});
