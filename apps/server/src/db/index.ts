import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

// Neon hands out IPv6 addresses too. On networks without IPv6, Node's address racing times out
// instead of falling back, so connect over IPv4 first.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

const client = postgres(env.DATABASE_URL, { max: 5, prepare: false });
export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
