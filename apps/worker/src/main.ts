import "reflect-metadata";
import { createServer } from "node:http";
import { loadEnv } from "@migrator/config";
import { migrateMetadata } from "@migrator/db";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { HealthQueueWorker } from "./health.worker";
import { WorkerModule } from "./worker.module";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  await migrateMetadata(env.DATABASE_URL);
  Logger.log("metadata migrations applied", "Bootstrap");
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  const worker = app.get(HealthQueueWorker);
  const server = createServer(async (req, res) => {
    const path = req.url ?? "/";
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "worker" }));
      return;
    }
    if (path === "/ready") {
      const body = await worker.readiness();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });
  server.listen(env.WORKER_HEALTH_PORT, env.API_HOST, () => {
    Logger.log(`worker health on ${env.API_HOST}:${env.WORKER_HEALTH_PORT}`, "Bootstrap");
  });
}

await bootstrap();
