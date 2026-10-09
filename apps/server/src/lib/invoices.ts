import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { logActivity } from "./activity.ts";
import { readFees } from "./captures.ts";
import { addDays, maxDate, today } from "./dates.ts";
import { money } from "./money.ts";
import { paypal } from "./paypal.ts";

type Milestone = typeof schema.milestones.$inferSelect;
type Project = typeof schema.projects.$inferSelect;

type Invoice = {
  id: string;
  status: string;
  payments?: {
    paid_amount?: { value: string };
    transactions?: { payment_id: string; method?: string }[];
  };
};

function splitName(full: string) {
  const [given, ...rest] = full.trim().split(/\s+/);
  return { given_name: given ?? full, surname: rest.join(" ") || undefined };
}

async function load(milestoneId: string) {
  const milestone = await db.query.milestones.findFirst({ where: eq(schema.milestones.id, milestoneId) });
  if (!milestone) throw new Error("Milestone not found");
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  if (!project) throw new Error("Project not found");
  return { milestone, project };
}

async function createAndSend(project: Project, milestone: Milestone, note?: string) {
  const invoice = await paypal<Invoice>("/v2/invoicing/invoices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      detail: {
        currency_code: project.currency,
        reference: milestone.id,
        note: note ?? `${project.name}: ${milestone.label}`,
        payment_term: { due_date: maxDate(milestone.dueDate ?? today(), today()) },
      },
      primary_recipients: [
        { billing_info: { email_address: project.clientEmail, name: splitName(project.clientName) } },
      ],
      items: [
        {
          name: milestone.label,
          description: project.name,
          quantity: "1",
          unit_amount: { currency_code: project.currency, value: Number(milestone.amount).toFixed(2) },
        },
      ],
    }),
  });
  const sent = await paypal<{ href?: string }>(`/v2/invoicing/invoices/${invoice.id}/send`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: true }),
  });
  await db
    .update(schema.milestones)
    .set({ paypalInvoiceId: invoice.id, payerUrl: sent?.href ?? null, status: "sent" })
    .where(eq(schema.milestones.id, milestone.id));
  return { invoiceId: invoice.id, payerUrl: sent?.href ?? null };
}

// Creates a PayPal invoice for one milestone and emails it to the client.
export async function sendMilestoneInvoice(milestoneId: string, note?: string) {
  const { milestone, project } = await load(milestoneId);
  if (milestone.paypalInvoiceId) throw new Error("Invoice already sent for this milestone");
  const result = await createAndSend(project, milestone, note);
  await logActivity(
    project.id,
    `Sent ${milestone.label} invoice for ${money(milestone.amount, project.currency)} to ${project.clientEmail}.`,
  );
  return result;
}

// Sends PayPal's reminder email for an unpaid invoice, with our own subject and note.
export async function remindInvoice(milestoneId: string, subject: string, note: string) {
  const { milestone, project } = await load(milestoneId);
  if (!milestone.paypalInvoiceId || milestone.status !== "sent") throw new Error("This invoice isn't waiting for payment");
  await paypal(`/v2/invoicing/invoices/${milestone.paypalInvoiceId}/remind`, {
    method: "POST",
    body: JSON.stringify({ subject, note, send_to_invoicer: false }),
  });
  await logActivity(project.id, `Reminder sent through PayPal for ${milestone.label}.`, "agent");
}

// Splits a late invoice in two: the client pays part now, which is enough to start the next
// phase, and the rest gets its own invoice due later. PayPal partial payments aren't open to
// every merchant country, so this uses a cancel and two new invoices instead.
export async function splitInvoice(milestoneId: string, percentNow: number, note: string) {
  const { milestone, project } = await load(milestoneId);
  if (milestone.status !== "sent" || !milestone.paypalInvoiceId) throw new Error("Only an unpaid sent invoice can be split");
  if (!(percentNow > 0 && percentNow < 100)) throw new Error("The part billed now must be between 1% and 99%");

  const total = Number(milestone.amount);
  const now = Math.round(total * percentNow) / 100;
  const later = Math.round((total - now) * 100) / 100;
  const nextPhase = milestone.phaseId
    ? await db.query.phases.findFirst({ where: eq(schema.phases.id, milestone.phaseId) }).then((phase) =>
        phase
          ? db.query.phases.findFirst({
              where: and(eq(schema.phases.projectId, project.id), eq(schema.phases.position, phase.position + 1)),
            })
          : undefined,
      )
    : undefined;

  await paypal(`/v2/invoicing/invoices/${milestone.paypalInvoiceId}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      subject: `${milestone.label}: replaced by two smaller invoices`,
      note: "This invoice is replaced by two smaller ones. The first is on its way now.",
      send_to_recipient: true,
      send_to_invoicer: false,
    }),
  });

  const [first, second] = await db.transaction(async (tx) => {
    await tx.update(schema.milestones).set({ status: "cancelled" }).where(eq(schema.milestones.id, milestone.id));
    return tx
      .insert(schema.milestones)
      .values([
        {
          projectId: project.id,
          phaseId: milestone.phaseId,
          label: `${milestone.label} (part 1)`,
          amount: now.toFixed(2),
          dueDate: today(),
        },
        {
          projectId: project.id,
          phaseId: milestone.phaseId,
          label: `${milestone.label} (part 2)`,
          amount: later.toFixed(2),
          // The rest is due when the next phase ends, or in two weeks if there is none.
          dueDate: nextPhase ? addDays(nextPhase.endDate, -1) : addDays(today(), 14),
          holdsNextPhase: false,
        },
      ])
      .returning();
  });

  await createAndSend(project, first!, note);
  await logActivity(
    project.id,
    `Split ${milestone.label} into ${money(now, project.currency)} now and ${money(later, project.currency)} later. Sent the first part.`,
    "agent",
  );
  return { firstId: first!.id, secondId: second!.id };
}

const STATUS_BY_PAYPAL: Record<string, string> = {
  PAID: "paid",
  MARKED_AS_PAID: "paid",
  PARTIALLY_PAID: "partially_paid",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "refunded",
  MARKED_AS_REFUNDED: "refunded",
};

const STATUS_BY_EVENT: Record<string, string> = {
  "INVOICING.INVOICE.PAID": "paid",
  "INVOICING.INVOICE.CANCELLED": "cancelled",
  "INVOICING.INVOICE.REFUNDED": "refunded",
};

// Reads the invoice from PayPal and brings the milestone up to date. PayPal is the source of
// truth; the webhook event type is only a fallback when the read fails.
export async function syncInvoice(invoiceId: string, eventType?: string) {
  const milestone = await db.query.milestones.findFirst({ where: eq(schema.milestones.paypalInvoiceId, invoiceId) });
  if (!milestone) return;

  let status = eventType ? STATUS_BY_EVENT[eventType] : undefined;
  let amountPaid = Number(milestone.amountPaid);
  let transactionIds = milestone.transactionIds;
  let captureIds: string[] = [];
  try {
    const invoice = await paypal<Invoice>(`/v2/invoicing/invoices/${invoiceId}`);
    status = STATUS_BY_PAYPAL[invoice.status] ?? (invoice.status === "SENT" || invoice.status === "UNPAID" ? "sent" : status);
    amountPaid = Number(invoice.payments?.paid_amount?.value ?? amountPaid);
    transactionIds = invoice.payments?.transactions?.map((t) => t.payment_id) ?? transactionIds;
    // Only payments made through PayPal have a capture; hand-recorded ones don't.
    captureIds = invoice.payments?.transactions?.filter((t) => t.method === "PAYPAL").map((t) => t.payment_id) ?? [];
  } catch (err) {
    console.warn(`[invoice] could not read ${invoiceId}:`, (err as Error).message);
  }
  if (!status) return;
  if (status === "paid") amountPaid = Math.max(amountPaid, Number(milestone.amount));

  const fees = captureIds.length > 0 ? await readFees(captureIds) : null;

  const changed = status !== milestone.status || amountPaid !== Number(milestone.amountPaid);
  await db
    .update(schema.milestones)
    .set({
      status,
      amountPaid: amountPaid.toFixed(2),
      transactionIds,
      ...(fees && { paypalFee: fees.fee.toFixed(2), netAmount: fees.net.toFixed(2) }),
    })
    .where(eq(schema.milestones.id, milestone.id));
  if (!changed) return;

  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  const currency = project?.currency ?? "USD";
  const messages: Record<string, [string, "payment" | "warning"]> = {
    paid: [
      `${milestone.label} paid through PayPal: ${money(milestone.amount, currency)}${fees ? `, ${money(fees.net, currency)} after PayPal's fee` : ""}.`,
      "payment",
    ],
    partially_paid: [
      `${milestone.label}: client paid ${money(amountPaid, currency)} of ${money(milestone.amount, currency)}.`,
      "payment",
    ],
    cancelled: [`${milestone.label} invoice (${money(milestone.amount, currency)}) was cancelled.`, "warning"],
    refunded: [`${milestone.label} payment (${money(milestone.amount, currency)}) was refunded.`, "warning"],
  };
  // A split cancels its own invoice and logs that itself.
  if (messages[status] && !(status === "cancelled" && milestone.status === "cancelled")) {
    const [message, kind] = messages[status]!;
    await logActivity(milestone.projectId, message, kind);
  }
  if (status === "paid" && milestone.phaseId) await unblockAfter(milestone.projectId, milestone.phaseId);
}

// A blocked phase waits on the phase right before it. Once every invoice on that phase that
// holds the next one is paid, unblock it.
async function unblockAfter(projectId: string, phaseId: string) {
  const phase = await db.query.phases.findFirst({ where: eq(schema.phases.id, phaseId) });
  if (!phase) return;
  const bills = await db.query.milestones.findMany({ where: eq(schema.milestones.phaseId, phaseId) });
  const holding = bills.filter((m) => m.holdsNextPhase && m.status !== "cancelled");
  if (!holding.every((m) => m.status === "paid")) return;

  const unblocked = await db
    .update(schema.phases)
    .set({ status: "planned" })
    .where(
      and(
        eq(schema.phases.projectId, projectId),
        eq(schema.phases.position, phase.position + 1),
        eq(schema.phases.status, "blocked"),
      ),
    )
    .returning({ name: schema.phases.name });
  for (const next of unblocked) {
    await logActivity(projectId, `${next.name} is no longer on hold. It can start now.`, "payment");
  }
}
