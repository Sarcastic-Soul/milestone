import { defineConfig } from "drizzle-kit";

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
