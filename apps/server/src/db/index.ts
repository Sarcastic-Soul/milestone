import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

const client = postgres(env.DATABASE_URL, { max: 5, prepare: false });
export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
