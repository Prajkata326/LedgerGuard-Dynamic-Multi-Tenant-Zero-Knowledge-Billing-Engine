import "dotenv/config";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  JWT_ISSUER: z.string().min(1).default("ledgerguard"),
  JWT_AUDIENCE: z.string().min(1).default("ledgerguard-api"),
  JWT_PUBLIC_KEY_PATH: z.string().min(1).default("./keys/jwt-public.pem"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  TENANT_DATABASE_URIS: z.string().default("{}"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.message}`);

let tenantUris: Record<string, string>;
try {
  tenantUris = z.record(z.string().min(1), z.string().url()).parse(JSON.parse(parsed.data.TENANT_DATABASE_URIS));
} catch (error) {
  throw new Error(`TENANT_DATABASE_URIS must be a JSON map of organization IDs to MongoDB URIs: ${String(error)}`);
}

export const config = { ...parsed.data, tenantUris };

export async function loadJwtPublicKey() {
  const pem = await readFile(config.JWT_PUBLIC_KEY_PATH, "utf8");
  return pem;
}
