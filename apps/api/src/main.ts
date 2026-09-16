import "reflect-metadata";
import { loadEnv } from "@migrator/config";
import { migrateMetadata } from "@migrator/db";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { RequestIdMiddleware } from "./common/request-id.middleware";

const JSON_BODY_LIMIT = "10mb";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  await migrateMetadata(env.DATABASE_URL);
  Logger.log("metadata migrations applied", "Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
  });
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { limit: JSON_BODY_LIMIT, extended: true });
  app.use(helmet());
  app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });
  await app.listen(env.API_PORT, env.API_HOST);
  Logger.log(`api listening on ${env.API_HOST}:${env.API_PORT}`, "Bootstrap");
}

await bootstrap();
