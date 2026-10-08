import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { publish } from "../lib/events.ts";
import { verifyWebhook } from "../lib/paypal.ts";

type PayPalEvent = { id: string; event_type: string; resource?: { id?: string } };

export const webhooks = new Hono().post("/paypal", async (c) => {
  const raw = await c.req.text();
  const event = JSON.parse(raw) as PayPalEvent;
  const verified = await verifyWebhook(c.req.raw.headers, raw).catch(() => false);
  if (!verified) console.warn(`[webhook] unverified ${event.event_type} ${event.id}`);

  const inserted = await db
    .insert(schema.paypalEvents)
    .values({
      id: event.id,
      eventType: event.event_type,
      resourceId: event.resource?.id ?? null,
      payload: event,
      verified,
    })
    .onConflictDoNothing()
    .returning({ id: schema.paypalEvents.id });

  // Only act on verified, first-time events. The agent hooks in here later.
  if (verified && inserted.length > 0) {
    publish({
      type: "paypal",
      eventType: event.event_type,
      resourceId: event.resource?.id ?? null,
      at: new Date().toISOString(),
    });
  }
  return c.body(null, 200);
});
