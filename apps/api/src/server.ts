import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import Redis from "ioredis";
import { authenticate } from "./auth.js";
import { config } from "./config.js";
import { closeTenantConnections } from "./db/tenant-connection.js";
import { billingRouter } from "./billing/routes.js";

const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true });
redis.on("error", (error) => console.error("Redis connection error", error.message));

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.WEB_ORIGIN, methods: ["GET", "POST"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }));
app.use(express.json({ limit: "32kb", strict: true }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/v1", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
app.use("/v1", authenticate);
app.use("/v1/billing", billingRouter(redis));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  res.status(status).json({ error: status < 500 && error instanceof Error ? error.message : "Internal server error" });
});

const server = app.listen(config.API_PORT, () => console.log(`LedgerGuard API listening on :${config.API_PORT}`));

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  server.close(async () => {
    await Promise.all([redis.quit().catch(() => undefined), closeTenantConnections()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
