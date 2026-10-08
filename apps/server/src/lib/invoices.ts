import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { logActivity } from "./activity.ts";
import { maxDate, today } from "./dates.ts";
import { paypal } from "./paypal.ts";

type Invoice = { id: string; status: string; links?: { rel: string; href: string }[] };

function splitName(full: string) {
  const [given, ...rest] = full.trim().split(/\s+/);
  return { given_name: given ?? full, surname: rest.join(" ") || undefined };
}

// Creates a PayPal invoice for one milestone and emails it to the client.
export async function sendMilestoneInvoice(milestoneId: string) {
  const milestone = await db.query.milestones.findFirst({ where: eq(schema.milestones.id, milestoneId) });
  if (!milestone) throw new Error("Milestone not found");
  if (milestone.paypalInvoiceId) throw new Error("Invoice already sent for this milestone");
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  if (!project) throw new Error("Project not found");

  const invoice = await paypal<Invoice>("/v2/invoicing/invoices", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      detail: {
        currency_code: project.currency,
        reference: milestone.id,
        note: `${project.name}: ${milestone.label}`,
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
  await logActivity(
    project.id,
    `Sent ${milestone.label} invoice for ${money(milestone.amount, project.currency)} to ${project.clientEmail}.`,
  );
  return { invoiceId: invoice.id, payerUrl: sent?.href ?? null };
}

function money(amount: string | number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
}

const STATUS_BY_EVENT: Record<string, string> = {
  "INVOICING.INVOICE.PAID": "paid",
  "INVOICING.INVOICE.CANCELLED": "cancelled",
  "INVOICING.INVOICE.REFUNDED": "refunded",
};

// Applies an invoice webhook: update the milestone, and when it's paid, unblock the next phase.
export async function applyInvoiceEvent(eventType: string, invoiceId: string) {
  const status = STATUS_BY_EVENT[eventType];
  if (!status) return;
  const milestone = await db.query.milestones.findFirst({ where: eq(schema.milestones.paypalInvoiceId, invoiceId) });
  if (!milestone) return;

  if (milestone.status === status) return;
  await db.update(schema.milestones).set({ status }).where(eq(schema.milestones.id, milestone.id));
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  const amount = money(milestone.amount, project?.currency ?? "USD");
  const messages: Record<string, [string, "payment" | "warning"]> = {
    paid: [`${milestone.label} paid through PayPal: ${amount}.`, "payment"],
    cancelled: [`${milestone.label} invoice (${amount}) was cancelled.`, "warning"],
    refunded: [`${milestone.label} payment (${amount}) was refunded.`, "warning"],
  };
  const [message, kind] = messages[status]!;
  await logActivity(milestone.projectId, message, kind);

  // A blocked phase waits on the phase right before it. Once every invoice on that phase is paid, unblock it.
  if (status === "paid" && milestone.phaseId) {
    const phase = await db.query.phases.findFirst({ where: eq(schema.phases.id, milestone.phaseId) });
    const siblings = await db.query.milestones.findMany({ where: eq(schema.milestones.phaseId, milestone.phaseId) });
    if (phase && siblings.every((m) => m.status === "paid")) {
      const unblocked = await db
        .update(schema.phases)
        .set({ status: "planned" })
        .where(
          and(
            eq(schema.phases.projectId, milestone.projectId),
            eq(schema.phases.position, phase.position + 1),
            eq(schema.phases.status, "blocked"),
          ),
        )
        .returning({ name: schema.phases.name });
      for (const next of unblocked) {
        await logActivity(milestone.projectId, `${next.name} is no longer on hold. It can start now.`, "payment");
      }
    }
  }
}
