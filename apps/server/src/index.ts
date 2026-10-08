import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { logger } from "hono/logger";
import { streamSSE } from "hono/streaming";
import { db } from "./db/index.ts";
import { env } from "./env.ts";
import { subscribe } from "./lib/events.ts";
import { getAccessToken } from "./lib/paypal.ts";
import { webhooks } from "./routes/webhooks.ts";

const app = new Hono();
app.use("/api/*", logger());

// Cheap route for the keep-alive ping; touches nothing.
app.get("/api/ping", (c) => c.text("pong"));

app.get("/api/health", async (c) => {
  const [dbOk, paypalOk] = await Promise.all([
    db.execute(sql`select 1`).then(() => true, () => false),
    getAccessToken().then(() => true, () => false),
  ]);
  return c.json({ db: dbOk, paypal: paypalOk, model: env.OLLAMA_MODEL }, dbOk && paypalOk ? 200 : 503);
});

app.get("/api/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = subscribe((event) => void stream.writeSSE({ data: JSON.stringify(event) }));
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ data: JSON.stringify({ type: "hello" }) });
    // Comment lines keep proxies from closing an idle stream.
    while (!stream.aborted) {
      await stream.sleep(25_000);
      await stream.write(": keep-alive\n\n");
    }
  }),
);

app.route("/api/webhooks", webhooks);

// In production the server also serves the built frontend. Bryntum makes the bundle big, so gzip it.
const webDist = resolve(import.meta.dirname, "../../web/dist");
app.use("/*", compress(), serveStatic({ root: webDist }));
app.get("*", serveStatic({ path: resolve(webDist, "index.html") }));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`server on http://localhost:${info.port}`);
});
