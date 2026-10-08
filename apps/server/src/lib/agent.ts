import type { SuggestionDraft, SuggestionKind } from "@milestone/shared";
import { generateText, stepCountIs, tool } from "ai";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.ts";
import { logActivity } from "./activity.ts";
import { addDays, daysBetween, shortDate, today } from "./dates.ts";
import { publish } from "./events.ts";
import { syncInvoice } from "./invoices.ts";
import { model } from "./llm.ts";
import { money } from "./money.ts";
import { paypalReadTools } from "./paypal-tools.ts";
import { syncPayoutBatch } from "./payouts.ts";

// The agent looks at a project's money, finds what needs doing, and asks the model to choose
// and word the actions. It only ever creates suggestions; the user approves each one.

type Candidate = {
  id: string;
  kind: SuggestionKind;
  targetId: string;
  title: string;
  // What the model is told about this action.
  facts: string;
  // Used as-is if the model is down, and as hints when it isn't.
  fallback: SuggestionDraft & { reason: string };
  minShift?: number;
};

const COOLDOWN_DAYS = 3;

async function loadState(projectId: string) {
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project) return null;
  const since = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000);
  const [phases, milestones, payouts, recent] = await Promise.all([
    db.select().from(schema.phases).where(eq(schema.phases.projectId, projectId)).orderBy(asc(schema.phases.position)),
    db.select().from(schema.milestones).where(eq(schema.milestones.projectId, projectId)),
    db.select().from(schema.payouts).where(eq(schema.payouts.projectId, projectId)),
    db
      .select()
      .from(schema.suggestions)
      .where(and(eq(schema.suggestions.projectId, projectId), gt(schema.suggestions.createdAt, since))),
  ]);
  const open = await db
    .select()
    .from(schema.suggestions)
    .where(and(eq(schema.suggestions.projectId, projectId), eq(schema.suggestions.status, "open")));
  return { project, phases, milestones, payouts, suggestions: [...recent, ...open] };
}

type State = NonNullable<Awaited<ReturnType<typeof loadState>>>;

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

function findCandidates(s: State): Candidate[] {
  const now = today();
  const { project, phases, milestones, payouts } = s;
  const cur = project.currency;
  const out: Candidate[] = [];
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const nextOf = (phaseId: string | null) => {
    const p = phaseId ? phaseById.get(phaseId) : undefined;
    return p ? phases.find((q) => q.position === p.position + 1) : undefined;
  };
  // Skip anything already open, or approved or dismissed in the last few days.
  const seen = (kind: SuggestionKind, targetId: string) =>
    s.suggestions.some((x) => x.kind === kind && x.targetId === targetId);
  const add = (c: Omit<Candidate, "id">) => {
    if (!seen(c.kind, c.targetId)) out.push({ ...c, id: `A${out.length + 1}` });
  };

  for (const m of milestones) {
    const amount = money(m.amount, cur);
    const next = nextOf(m.phaseId);
    const holdsUp = m.holdsNextPhase && next?.status === "blocked" ? next : undefined;

    if (m.status === "pending" && m.dueDate && daysBetween(now, m.dueDate) <= 3) {
      add({
        kind: "send_invoice",
        targetId: m.id,
        title: `Send the ${m.label} invoice (${amount})`,
        facts: `"${m.label}" for ${amount} is due ${shortDate(m.dueDate)} and hasn't been sent yet.`,
        fallback: {
          note: `${project.name}: ${m.label}. Thank you!`,
          reason: `It's due ${m.dueDate < now ? "already" : shortDate(m.dueDate)}, and the client can't pay an invoice they don't have.`,
        },
      });
    }

    if (m.status === "sent" && m.dueDate && m.dueDate < now) {
      const late = daysBetween(m.dueDate, now);
      const blocking = holdsUp ? ` It holds up "${holdsUp.name}", which was meant to start ${shortDate(holdsUp.startDate)}.` : "";
      add({
        kind: "reminder",
        targetId: m.id,
        title: `Remind ${firstName(project.clientName)} about ${m.label}`,
        facts: `"${m.label}" for ${amount} (PayPal invoice ${m.paypalInvoiceId}) was due ${shortDate(m.dueDate)}, ${late} days ago.${blocking}`,
        fallback: {
          subject: `Reminder: ${m.label} for ${project.name}`,
          note: `Hi ${firstName(project.clientName)}, a quick reminder that the ${m.label} invoice for ${amount} was due on ${shortDate(m.dueDate)}.${holdsUp ? ` Once it's paid we can start ${holdsUp.name}.` : ""} You can pay it from the PayPal email. Thank you!`,
          reason: `${amount} is ${late} ${late === 1 ? "day" : "days"} late.${holdsUp ? ` ${holdsUp.name} can't start until it's paid.` : ""}`,
        },
      });
      if (holdsUp && !m.label.includes("(part")) {
        add({
          kind: "partial_payment",
          targetId: m.id,
          title: `Let ${firstName(project.clientName)} pay part of ${m.label} now`,
          facts: `Split "${m.label}" (${amount}) into two invoices: a share now that unblocks "${holdsUp.name}", the rest due later.`,
          fallback: {
            minimumPercent: 50,
            note: `Hi ${firstName(project.clientName)}, to keep things moving I've split the ${m.label} invoice. This first half lets us start ${holdsUp.name}; the rest is due later. Thank you!`,
            reason: `Paying half now gets ${holdsUp.name} started instead of waiting on the full ${amount}.`,
          },
        });
      }
    }
  }

  for (const p of phases) {
    if (p.status !== "blocked" || daysBetween(now, p.startDate) > 1) continue;
    const minShift = Math.max(1, daysBetween(p.startDate, now) + 2);
    const later = phases.filter((q) => q.position > p.position).length;
    const shift = Math.ceil(minShift / 7) * 7;
    add({
      kind: "replan",
      targetId: p.id,
      title: `Move ${p.name}${later ? ` and ${later} later ${later === 1 ? "phase" : "phases"}` : ""}`,
      facts: `"${p.name}" is on hold until the previous payment arrives. It was meant to start ${shortDate(p.startDate)}. Shift it at least ${minShift} days so the plan isn't showing work that can't happen.`,
      fallback: {
        shiftDays: shift,
        reason: `${p.name} was meant to start ${shortDate(p.startDate)} but is still waiting on payment. Moving it ${shift} days keeps the schedule honest; the project would end ${shortDate(addDays(phases.at(-1)!.endDate, shift - 1))}.`,
      },
      minShift,
    });
  }

  for (const po of payouts) {
    if (po.status !== "pending" || !po.phaseId) continue;
    const phase = phaseById.get(po.phaseId);
    const bills = milestones.filter((m) => m.phaseId === po.phaseId && m.holdsNextPhase && m.status !== "cancelled");
    const ready = bills.length > 0 ? bills.every((m) => m.status === "paid") : !!phase && phase.endDate <= now;
    if (!ready) continue;
    const amount = money(po.amount, cur);
    add({
      kind: "payout",
      targetId: po.id,
      title: `Pay ${po.name} ${amount}`,
      facts: `${po.name} is owed ${amount} "${po.trigger}". ${phase ? `The client has paid for "${phase.name}".` : ""}`,
      fallback: {
        note: `Thanks for your work on ${project.name}.`,
        reason: `The contract says ${po.name} is paid ${po.trigger.toLowerCase()}, and the client's payment for that phase is in.`,
      },
    });
  }
  return out;
}

const SYSTEM = `You are the payments assistant inside Milestone, a project tracker for freelancers.
You look at one project and propose actions. You never act yourself: each call to "propose"
puts a card in front of the freelancer, who approves or dismisses it.

Rules:
- Only propose actions from the list you're given, by their id (A1, A2, ...).
- Propose a reminder for every late invoice. Propose a split or a replan only when a late
  payment is holding up the next phase. Propose every send_invoice and payout you're given.
- Client-facing text (subject, note) is from the freelancer to the client: start with
  "Hi <first name>,", then be warm, short, and specific about the amount and what it unlocks.
  No guilt, no threats, no sign-off name.
- "reason" is for the freelancer: one or two plain sentences with the concrete amounts and
  dates. Never mention invoice ids or action ids.
- For a replan, the shift must be at least the minimum given; say the number of days you chose.
- You may call get_invoice first if checking the invoice would change what you suggest.
- Call "propose" once per action, then stop.`;

async function draftWithModel(s: State, candidates: Candidate[]) {
  const chosen = new Map<string, SuggestionDraft & { reason: string }>();
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const propose = tool({
    description: "Put one suggested action in front of the freelancer for approval.",
    inputSchema: z.object({
      action: z.string().describe("Action id, e.g. A1"),
      reason: z.string().describe("Why, for the freelancer"),
      subject: z.string().optional().describe("reminder only: email subject"),
      note: z.string().optional().describe("Message to the client (or to the subcontractor for a payout)"),
      percentNow: z.number().int().min(10).max(90).optional().describe("partial_payment only: share billed now"),
      shiftDays: z.number().int().min(1).max(60).optional().describe("replan only: days to move the phase"),
    }),
    execute: async (input) => {
      const c = byId.get(input.action);
      if (!c) return `Unknown action ${input.action}. Use one of: ${[...byId.keys()].join(", ")}.`;
      const draft: SuggestionDraft & { reason: string } = { reason: input.reason };
      if (c.kind === "reminder") {
        draft.subject = input.subject || c.fallback.subject;
        draft.note = input.note || c.fallback.note;
      } else if (c.kind === "partial_payment") {
        draft.minimumPercent = input.percentNow ?? c.fallback.minimumPercent;
        draft.note = input.note || c.fallback.note;
      } else if (c.kind === "replan") {
        draft.shiftDays = Math.max(input.shiftDays ?? c.fallback.shiftDays ?? 0, c.minShift ?? 1);
      } else {
        draft.note = input.note || c.fallback.note;
      }
      chosen.set(c.id, draft);
      return "Added.";
    },
  });

  const list = candidates.map((c) => `${c.id} [${c.kind}] ${c.title}. ${c.facts}`).join("\n");
  const result = await generateText({
    model,
    system: SYSTEM,
    prompt: `Today is ${today()}.
Project: ${s.project.name}. Client: ${s.project.clientName} <${s.project.clientEmail}>.

Actions you can propose:
${list}`,
    tools: { propose, ...paypalReadTools() },
    stopWhen: stepCountIs(10),
    temperature: 0.3,
  });
  return { chosen, steps: result.steps.length };
}

async function check(projectId: string) {
  // Bring PayPal's view in first, so the agent never nags about something already paid.
  const before = await db.query.milestones.findMany({ where: eq(schema.milestones.projectId, projectId) });
  for (const m of before) if (m.paypalInvoiceId && m.status === "sent") await syncInvoice(m.paypalInvoiceId).catch(() => {});
  const sent = await db.query.payouts.findMany({
    where: and(eq(schema.payouts.projectId, projectId), eq(schema.payouts.status, "sent")),
  });
  for (const p of sent) if (p.paypalBatchId) await syncPayoutBatch(p.paypalBatchId).catch(() => {});

  const state = await loadState(projectId);
  if (!state) return;
  const candidates = findCandidates(state);

  let drafts = new Map<string, SuggestionDraft & { reason: string }>();
  if (candidates.length > 0) {
    try {
      drafts = (await draftWithModel(state, candidates)).chosen;
    } catch (err) {
      console.warn("[agent] model failed, using plain drafts:", (err as Error).message);
    }
    // If the model is down or skipped everything, still surface what needs doing.
    if (drafts.size === 0) for (const c of candidates) drafts.set(c.id, c.fallback);
  }

  const created: string[] = [];
  for (const c of candidates) {
    const draft = drafts.get(c.id);
    if (!draft) continue;
    const { reason, ...rest } = draft;
    await db
      .insert(schema.suggestions)
      .values({ projectId, kind: c.kind, targetId: c.targetId, title: c.title, reason, draft: rest });
    created.push(c.title);
  }
  await db.update(schema.projects).set({ agentCheckedAt: new Date() }).where(eq(schema.projects.id, projectId));
  if (created.length > 0) {
    await logActivity(
      projectId,
      created.length === 1 ? `Milestone suggests: ${created[0]}.` : `Milestone has ${created.length} suggestions for you.`,
      "agent",
    );
  }
}

// Ollama's free tier refuses parallel requests, so runs go one at a time.
let chain: Promise<unknown> = Promise.resolve();
const queued = new Set<string>();

export function checkProject(projectId: string): Promise<void> {
  if (queued.has(projectId)) return chain.then(() => undefined);
  queued.add(projectId);
  const run = chain.then(async () => {
    queued.delete(projectId);
    publish({ type: "agent", projectId, running: true });
    try {
      await check(projectId);
    } catch (err) {
      console.error("[agent]", err);
    } finally {
      publish({ type: "agent", projectId, running: false });
      publish({ type: "project", projectId, reason: "agent" });
    }
  });
  chain = run;
  return run;
}

// Checks every project that still has money moving, a few times a day.
export function startAgentSchedule(everyMs = 3 * 60 * 60 * 1000) {
  const tick = async () => {
    const active = await db
      .selectDistinct({ id: schema.milestones.projectId })
      .from(schema.milestones)
      .where(ne(schema.milestones.status, "paid"));
    for (const { id } of active) void checkProject(id);
  };
  setTimeout(() => void tick().catch(console.error), 30_000);
  setInterval(() => void tick().catch(console.error), everyMs);
}
