import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { env } from "../env.ts";
import { logActivity } from "./activity.ts";
import { money } from "./money.ts";
import { paypal } from "./paypal.ts";

type Batch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { transaction_status: string; payout_item: { sender_item_id?: string } }[];
};

const STATUS_BY_ITEM: Record<string, string> = {
  SUCCESS: "success",
  UNCLAIMED: "unclaimed",
  FAILED: "failed",
  RETURNED: "failed",
  BLOCKED: "failed",
  REFUNDED: "failed",
  REVERSED: "failed",
  DENIED: "failed",
};

// Pays a subcontractor through PayPal Payouts.
export async function sendPayout(payoutId: string, note: string) {
  const payout = await db.query.payouts.findFirst({ where: eq(schema.payouts.id, payoutId) });
  if (!payout) throw new Error("Payout not found");
  if (payout.status !== "pending" && payout.status !== "failed") throw new Error("This payout was already sent");
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, payout.projectId) });
  if (!project) throw new Error("Project not found");

  const sandboxPayee = env.PAYPAL_ENVIRONMENT === "SANDBOX" ? env.SANDBOX_PAYEE_EMAIL : undefined;
  const receiver = sandboxPayee ?? payout.email;
  if (!receiver) throw new Error(`No PayPal email for ${payout.name}. Add one before paying.`);

  const batch = await paypal<Batch>("/v1/payments/payouts", {
    method: "POST",
    body: JSON.stringify({
      sender_batch_header: {
        // Same id for the same payout, so a double click can't pay twice.
        sender_batch_id: `${payout.id}-${payout.status === "failed" ? Date.now() : "1"}`,
        email_subject: `Payment for ${project.name}`,
        email_message: note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver,
          amount: { value: Number(payout.amount).toFixed(2), currency: project.currency },
          note,
          sender_item_id: payout.id,
        },
      ],
    }),
  });

  await db
    .update(schema.payouts)
    .set({ paypalBatchId: batch.batch_header.payout_batch_id, status: "sent" })
    .where(eq(schema.payouts.id, payout.id));
  const to = sandboxPayee ? `${payout.name} (sandbox test account)` : payout.name;
  await logActivity(project.id, `Sent ${money(payout.amount, project.currency)} to ${to} through PayPal Payouts.`, "agent");
  return batch.batch_header;
}

// Reads a payout batch from PayPal and updates our payouts. Used by webhooks and the agent.
export async function syncPayoutBatch(batchId: string) {
  const batch = await paypal<Batch>(`/v1/payments/payouts/${batchId}`);
  for (const item of batch.items ?? []) {
    const id = item.payout_item.sender_item_id;
    const status = STATUS_BY_ITEM[item.transaction_status];
    if (!id || !status) continue;
    const payout = await db.query.payouts.findFirst({ where: eq(schema.payouts.id, id) });
    if (!payout || payout.status === status) continue;
    await db.update(schema.payouts).set({ status }).where(eq(schema.payouts.id, id));
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, payout.projectId) });
    const amount = money(payout.amount, project?.currency);
    const messages: Record<string, [string, "payment" | "warning"]> = {
      success: [`${payout.name} received ${amount}.`, "payment"],
      unclaimed: [`${payout.name} hasn't claimed ${amount} yet. PayPal holds it for 30 days.`, "warning"],
      failed: [`Payout of ${amount} to ${payout.name} failed.`, "warning"],
    };
    const [message, kind] = messages[status]!;
    await logActivity(payout.projectId, message, kind);
  }
}
