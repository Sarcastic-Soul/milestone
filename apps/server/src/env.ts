import { resolve } from "node:path";
import { z } from "zod";

// Local dev reads the repo-root .env; on Render the vars come from the dashboard.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {}

export const env = z
  .object({
    PAYPAL_CLIENT_ID: z.string().min(1),
    PAYPAL_SECRET: z.string().min(1),
    PAYPAL_ENVIRONMENT: z.enum(["SANDBOX", "LIVE"]).default("SANDBOX"),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    OLLAMA_API_KEY: z.string().min(1),
    OLLAMA_BASE_URL: z.url().default("https://ollama.com/v1"),
    OLLAMA_MODEL: z.string().default("gemma4:31b"),
    DATABASE_URL: z.url(),
    PORT: z.coerce.number().default(8787),
  })
  .parse(process.env);
