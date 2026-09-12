import pino, { type Logger } from "pino";

export function createLogger(
  name: string,
  bindings: Record<string, string | number | boolean | null | undefined> = {},
): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    base: {
      service: name,
      ...bindings,
    },
    redact: {
      paths: ["password", "passwordCiphertext", "*.password", "SECRETS_MASTER_KEY", "DATABASE_URL"],
      remove: true,
    },
  });
}
