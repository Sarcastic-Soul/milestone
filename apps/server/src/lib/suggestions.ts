import type { SuggestionDraft } from "@milestone/shared";
import { and, arrayOverlaps, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import { logActivity } from "./activity.ts";
import { addDays, shortDate } from "./dates.ts";
import { publish } from "./events.ts";
import { remindInvoice, sendMilestoneInvoice, splitInvoice } from "./invoices.ts";
import { money } from "./money.ts";
import { sendPayout } from "./payouts.ts";

export class SuggestionError extends Error {}

// Pushes a phase and every phase after it by `days`, along with any invoice on them that
// hasn't gone out yet. Sent invoices keep their dates: the client already has them.
async function shiftPhases(phaseId: string, days: number) {
  const phase = await db.query.phases.findFirst({ where: eq(schema.phases.id, phaseId) });
  if (!phase) throw new SuggestionError("Phase not found");
  const moving = await db.query.phases.findMany({
    where: and(eq(schema.phases.projectId, phase.projectId), gte(schema.phases.position, phase.position)),
  });
  const ids = moving.map((p) => p.id);
  const bills = await db.query.milestones.findMany({
    where: and(inArray(schema.milestones.phaseId, ids), eq(schema.milestones.status, "pending")),
  });
  await db.transaction(async (tx) => {
    for (const p of moving) {
      await tx
        .update(schema.phases)
        .set({ startDate: addDays(p.startDate, days), endDate: addDays(p.endDate, days) })
        .where(eq(schema.phases.id, p.id));
    }
    for (const m of bills) {
      if (!m.dueDate) continue;
      await tx.update(schema.milestones).set({ dueDate: addDays(m.dueDate, days) }).where(eq(schema.milestones.id, m.id));
    }
  });
  const last = moving.reduce((a, b) => (b.position > a.position ? b : a));
  const others = moving.length - 1;
  await logActivity(
    phase.projectId,
    `Moved ${phase.name}${others ? ` and ${others} later ${others === 1 ? "phase" : "phases"}` : ""} by ${days} days. The project now ends ${shortDate(addDays(last.endDate, days - 1))}.`,
    "agent",
  );
}

async function pausePhase(phaseId: string) {
  const [phase] = await db
    .update(schema.phases)
    .set({ status: "blocked" })
    .where(eq(schema.phases.id, phaseId))
    .returning();
  if (!phase) throw new SuggestionError("Phase not found");
  await logActivity(phase.projectId, `Put ${phase.name} on hold until the dispute is settled.`, "warning");
}

async function run(kind: string, targetId: string, draft: SuggestionDraft) {
  switch (kind) {
    case "send_invoice":
      return sendMilestoneInvoice(targetId, draft.note);
    case "reminder":
      if (!draft.subject?.trim() || !draft.note?.trim()) throw new SuggestionError("The reminder needs a subject and a note.");
      return remindInvoice(targetId, draft.subject, draft.note);
    case "partial_payment": {
      const percent = Math.round(draft.minimumPercent ?? 50);
      if (percent < 10 || percent > 90) throw new SuggestionError("Bill between 10% and 90% now.");
      return splitInvoice(targetId, percent, draft.note ?? "");
    }
    case "replan": {
      const days = Math.round(draft.shiftDays ?? 0);
      if (days < 1 || days > 120) throw new SuggestionError("Shift by 1 to 120 days.");
      return shiftPhases(targetId, days);
    }
    case "payout":
      return sendPayout(targetId, draft.note?.trim() || "Thanks for your work.");
    case "pause":
      return pausePhase(targetId);
    default:
      throw new SuggestionError(`Unknown suggestion kind: ${kind}`);
  }
}

// Carries out a suggestion, with any edits the user made to the draft.
export async function approveSuggestion(id: string, edits: SuggestionDraft = {}) {
  // Claim it first, so a double click can't send two reminders.
  const [s] = await db
    .update(schema.suggestions)
    .set({ status: "approved", resolvedAt: new Date(), error: null })
    .where(and(eq(schema.suggestions.id, id), eq(schema.suggestions.status, "open")))
    .returning();
  if (!s) throw new SuggestionError("This suggestion was already handled.");
  const draft = { ...(s.draft as SuggestionDraft), ...edits };
  try {
    await run(s.kind, s.targetId, draft);
    await db.update(schema.suggestions).set({ draft }).where(eq(schema.suggestions.id, id));
  } catch (err) {
    // Put it back so the user can fix the draft or try again.
    const message = (err as Error).message;
    await db
      .update(schema.suggestions)
      .set({ status: "open", resolvedAt: null, error: message, draft })
      .where(eq(schema.suggestions.id, id));
    publish({ type: "project", projectId: s.projectId, reason: "suggestion failed" });
    throw err instanceof SuggestionError ? err : new SuggestionError(message);
  }
  publish({ type: "project", projectId: s.projectId, reason: "suggestion approved" });
}

export async function dismissSuggestion(id: string) {
  const [s] = await db
    .update(schema.suggestions)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(and(eq(schema.suggestions.id, id), eq(schema.suggestions.status, "open")))
    .returning();
  if (s) publish({ type: "project", projectId: s.projectId, reason: "suggestion dismissed" });
}

type Dispute = {
  dispute_id?: string;
  reason?: string;
  dispute_amount?: { value?: string; currency_code?: string };
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
};

// A client opened a dispute on a payment. Find the invoice it came from and suggest holding
// the work that payment was paying for, so the freelancer doesn't keep building on it.
export async function handleDispute(dispute: Dispute, eventType: string) {
  const txIds = (dispute.disputed_transactions ?? [])
    .flatMap((t) => [t.seller_transaction_id, t.buyer_transaction_id])
    .filter((x): x is string => !!x);
  if (txIds.length === 0) return;
  const milestone = await db.query.milestones.findFirst({
    where: arrayOverlaps(schema.milestones.transactionIds, txIds),
  });
  if (!milestone) return;
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  if (!project) return;
  const amount = dispute.dispute_amount?.value
    ? money(dispute.dispute_amount.value, dispute.dispute_amount.currency_code ?? project.currency)
    : money(milestone.amount, project.currency);
  const why = (dispute.reason ?? "").toLowerCase().replaceAll("_", " ");

  if (eventType === "CUSTOMER.DISPUTE.RESOLVED") {
    await logActivity(project.id, `The dispute on ${milestone.label} (${amount}) is closed.`, "info");
    return;
  }
  if (eventType !== "CUSTOMER.DISPUTE.CREATED") {
    await logActivity(project.id, `The dispute on ${milestone.label} was updated in PayPal.`, "warning");
    return;
  }
  await logActivity(
    project.id,
    `${project.clientName} opened a PayPal dispute on ${milestone.label} (${amount})${why ? `: ${why}` : ""}.`,
    "warning",
  );

  // Hold the phase that payment unlocked, or the next one not finished yet.
  const phases = await db.query.phases.findMany({ where: eq(schema.phases.projectId, project.id) });
  const paidFor = phases.find((p) => p.id === milestone.phaseId);
  const target = phases
    .filter((p) => p.status !== "done" && p.status !== "blocked" && (!paidFor || p.position > paidFor.position))
    .sort((a, b) => a.position - b.position)[0];
  if (!target) return;
  const open = await db.query.suggestions.findFirst({
    where: and(
      eq(schema.suggestions.targetId, target.id),
      eq(schema.suggestions.kind, "pause"),
      eq(schema.suggestions.status, "open"),
    ),
  });
  if (open) return;
  await db.insert(schema.suggestions).values({
    projectId: project.id,
    kind: "pause",
    targetId: target.id,
    title: `Hold ${target.name} while the dispute is open`,
    reason: `${project.clientName} disputed the ${amount} paid for ${milestone.label}. If PayPal sides with them, that money goes back, so new work on ${target.name} could go unpaid. Reply to the dispute in PayPal${dispute.dispute_id ? ` (case ${dispute.dispute_id})` : ""} with the approved deliverables.`,
  });
  publish({ type: "project", projectId: project.id, reason: "dispute" });
}
