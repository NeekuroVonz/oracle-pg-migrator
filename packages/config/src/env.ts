import { DATA_COPY_CHUNK_SIZE_DEFAULT, DATA_COPY_CHUNK_SIZE_MAX } from "@migrator/shared";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SECRETS_MASTER_KEY: z.string().min(1),
  ORACLE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  ORACLE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  VALIDATOR_DATABASE_URL: z.string().min(1).optional(),
  VALIDATOR_POOL_SIZE: z.coerce.number().int().min(1).max(32).default(2),
  VALIDATOR_MODE: z.enum(["database", "docker"]).default("database"),
  VALIDATOR_DOCKER_IMAGE: z.string().default("postgres:16-alpine"),
  VALIDATOR_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  ORA2PG_BIN: z.string().optional(),
  AI_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  DATA_COPY_CHUNK_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(DATA_COPY_CHUNK_SIZE_MAX)
    .default(DATA_COPY_CHUNK_SIZE_DEFAULT),
  AI_OPENAI_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? value : undefined)),
  AI_OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_OPENAI_BASE_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`invalid environment: ${JSON.stringify(details)}`);
  }
  return parsed.data;
}
