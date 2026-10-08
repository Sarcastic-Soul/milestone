import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { checkProject } from "../lib/agent.ts";
import { publish } from "../lib/events.ts";
import { syncInvoice } from "../lib/invoices.ts";
import { verifyWebhook } from "../lib/paypal.ts";
import { syncPayoutBatch } from "../lib/payouts.ts";
import { handleDispute } from "../lib/suggestions.ts";

type PayPalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    invoice?: { id?: string };
    payout_batch_id?: string;
    batch_header?: { payout_batch_id?: string };
    [key: string]: unknown;
  };
};

async function handle(event: PayPalEvent, resourceId: string | null) {
  const type = event.event_type;
  const r = event.resource ?? {};
  if (type.startsWith("INVOICING.") && resourceId) {
    await syncInvoice(resourceId, type);
    const m = await db.query.milestones.findFirst({ where: eq(schema.milestones.paypalInvoiceId, resourceId) });
    // A payment can change what's worth suggesting (a payout is now due, a phase can start).
    if (m) void checkProject(m.projectId);
  } else if (type.startsWith("PAYMENT.PAYOUTS")) {
    const batchId = r.batch_header?.payout_batch_id ?? r.payout_batch_id;
    if (batchId) await syncPayoutBatch(batchId);
  } else if (type.startsWith("CUSTOMER.DISPUTE.")) {
    await handleDispute(r as Parameters<typeof handleDispute>[0], type);
  }
}

export const webhooks = new Hono().post("/paypal", async (c) => {
  const raw = await c.req.text();
  const event = JSON.parse(raw) as PayPalEvent;
  const verified = await verifyWebhook(c.req.raw.headers, raw).catch(() => false);
  // Invoice events wrap the invoice; other events put the id on the resource itself.
  const resourceId = event.resource?.invoice?.id ?? event.resource?.id ?? null;
  if (!verified) console.warn(`[webhook] unverified ${event.event_type} ${event.id}`);

  const inserted = await db
    .insert(schema.paypalEvents)
    .values({
      id: event.id,
      eventType: event.event_type,
      resourceId,
      payload: event,
      verified,
    })
    .onConflictDoNothing()
    .returning({ id: schema.paypalEvents.id });

  // Only act on verified, first-time events.
  if (verified && inserted.length > 0) {
    publish({ type: "paypal", eventType: event.event_type, resourceId, at: new Date().toISOString() });
    await handle(event, resourceId).catch((err) => console.error(`[webhook] ${event.event_type}:`, err));
  }
  return c.body(null, 200);
});
