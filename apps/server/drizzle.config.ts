import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { defineConfig } from "drizzle-kit";

// Same IPv4-first rule as src/db/index.ts, for Neon on networks without IPv6.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

// drizzle-kit loads this as CommonJS, so read the root .env by cwd, not import.meta.
try {
  process.loadEnvFile("../../.env");
} catch {}

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
