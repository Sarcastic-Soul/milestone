import type { ProjectDetail, Suggestion, SuggestionDraft, SuggestionKind } from "@milestone/shared";
import {
  ArrowClockwiseIcon,
  BellRingingIcon,
  CalendarDotsIcon,
  HandCoinsIcon,
  type Icon,
  PaperPlaneTiltIcon,
  PauseIcon,
  ScissorsIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState } from "react";
import { useAgentRunning } from "../lib/agentStatus.ts";
import { useCheckProject, useResolveSuggestion } from "../lib/api.ts";
import { lastDay, money, shortDate, timeAgo } from "../lib/format.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";

const KIND: Record<SuggestionKind, { label: string; icon: Icon }> = {
  send_invoice: { label: "Invoice", icon: PaperPlaneTiltIcon },
  reminder: { label: "Reminder", icon: BellRingingIcon },
  partial_payment: { label: "Split payment", icon: ScissorsIcon },
  replan: { label: "Schedule", icon: CalendarDotsIcon },
  payout: { label: "Payout", icon: HandCoinsIcon },
  pause: { label: "Dispute", icon: PauseIcon },
};

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The agent's to-do list for this project. Each item is a draft; nothing reaches the client
// or PayPal until the freelancer presses the main button on it.
export function Suggestions({ project }: { project: ProjectDetail }) {
  const running = useAgentRunning(project.id);
  const check = useCheckProject(project.id);
  const busy = running || check.isPending;
  const items = project.suggestions;
  const reduce = useReducedMotion();

  return (
    <section aria-labelledby="todo-heading" className="border-t border-rule px-4 py-7 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h2 id="todo-heading" className="font-display text-[26px] leading-tight">
            Needs your OK
            {items.length > 0 && <span className="num ml-2 text-lg text-ink-2">{items.length}</span>}
          </h2>
          <p className="text-[13px] text-ink-2">
            Milestone watches PayPal and your dates, then drafts what to do. Nothing goes out until you approve it.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-ink-2" aria-live="polite">
            {busy ? "Checking PayPal now" : project.agentCheckedAt ? `Checked ${timeAgo(project.agentCheckedAt).toLowerCase()}` : "Not checked yet"}
          </span>
          <Button onClick={() => check.mutate()} disabled={busy}>
            <ArrowClockwiseIcon weight="bold" aria-hidden className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
            Check now
          </Button>
        </div>
      </div>
      {check.error && <Alert className="mt-4">{check.error.message}</Alert>}

      {items.length === 0 ? (
        <p className="mt-5 border-t border-rule pt-4 text-sm text-ink-2">
          {busy ? "Reading invoices and payouts from PayPal." : "Nothing needs you right now. Milestone checks again every few hours and whenever PayPal sends news."}
        </p>
      ) : (
        <ul className="mt-5 grid gap-x-10 md:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {items.map((s) => (
              <motion.li
                key={s.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ type: "spring", bounce: 0, duration: 0.35 }}
                className="min-w-0 border-t border-rule pt-4 pb-6"
              >
                <SuggestionItem project={project} suggestion={s} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function SuggestionItem({ project, suggestion: s }: { project: ProjectDetail; suggestion: Suggestion }) {
  const resolve = useResolveSuggestion(project.id);
  const [draft, setDraft] = useState<SuggestionDraft>(s.draft);
  const [editing, setEditing] = useState(false);
  const ids = useId();
  const { label, icon: KindIcon } = KIND[s.kind];
  const cur = project.currency;
  const milestone = project.milestones.find((m) => m.id === s.targetId);
  const payout = project.payouts.find((p) => p.id === s.targetId);
  const phase = project.phases.find((p) => p.id === s.targetId);
  const lastEnd = project.phases.at(-1)?.endDate;
  const pending = resolve.isPending;
  const error = resolve.error?.message ?? s.error;
  const set = (patch: SuggestionDraft) => setDraft((d) => ({ ...d, ...patch }));

  const percent = draft.minimumPercent ?? 50;
  const nowAmount = milestone ? Math.round(milestone.amount * percent) / 100 : 0;
  const shift = draft.shiftDays ?? 7;

  const approveLabel: Record<SuggestionKind, string> = {
    send_invoice: "Send invoice",
    reminder: "Send reminder",
    partial_payment: "Split and send",
    replan: `Move ${shift} days`,
    payout: payout ? `Pay ${money(payout.amount, cur)}` : "Send payout",
    pause: "Put on hold",
  };
  const hasMessage = s.kind !== "replan" && s.kind !== "pause";
  const canEdit = s.kind !== "pause";

  return (
    <article aria-labelledby={`${ids}-title`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <KindIcon weight="bold" aria-hidden />
        {label}
      </div>
      <h3 id={`${ids}-title`} className="mt-1 text-[15px] font-semibold leading-snug">
        {s.title}
      </h3>
      <p className="mt-1 max-w-[60ch] text-[13px] text-ink-2">{s.reason}</p>

      {/* What will actually happen, in numbers. */}
      {s.kind === "partial_payment" && milestone && (
        <p className="mt-3 text-sm">
          <span className="num font-semibold">{money(nowAmount, cur)}</span> now,{" "}
          <span className="num">{money(milestone.amount - nowAmount, cur)}</span> on a second invoice due later.
        </p>
      )}
      {s.kind === "replan" && phase && lastEnd && (
        <p className="mt-3 text-sm">
          {phase.name} starts <span className="num font-semibold">{shortDate(addDays(phase.startDate, shift))}</span>. Project ends{" "}
          <span className="num font-semibold">{shortDate(lastDay(addDays(lastEnd, shift)))}</span> instead of{" "}
          <span className="num">{shortDate(lastDay(lastEnd))}</span>.
        </p>
      )}

      {editing ? (
        <div className="mt-3 grid gap-3">
          {s.kind === "partial_payment" && (
            <NumberField id={`${ids}-pct`} label="Bill now (%)" value={percent} min={10} max={90} step={5} onChange={(v) => set({ minimumPercent: v })} />
          )}
          {s.kind === "replan" && (
            <NumberField id={`${ids}-days`} label="Move by (days)" value={shift} min={1} max={120} step={1} onChange={(v) => set({ shiftDays: v })} />
          )}
          {s.kind === "reminder" && (
            <div className="grid gap-1">
              <label htmlFor={`${ids}-subject`} className="text-xs font-semibold">
                Subject
              </label>
              <input
                id={`${ids}-subject`}
                value={draft.subject ?? ""}
                onChange={(e) => set({ subject: e.target.value })}
                className="border-[1.5px] border-field bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
          )}
          {hasMessage && (
            <div className="grid gap-1">
              <label htmlFor={`${ids}-note`} className="text-xs font-semibold">
                {s.kind === "payout" ? `Note to ${payout?.name ?? "them"}` : `Message to ${project.clientName.split(" ")[0]}`}
              </label>
              <textarea
                id={`${ids}-note`}
                rows={4}
                value={draft.note ?? ""}
                onChange={(e) => set({ note: e.target.value })}
                className="w-full resize-y border-[1.5px] border-field bg-paper px-3 py-2.5 text-sm leading-relaxed focus:border-ink focus:outline-none"
              />
            </div>
          )}
        </div>
      ) : (
        hasMessage &&
        draft.note && (
          <blockquote className="mt-3 max-w-[60ch] border-l-2 border-field pl-3 text-sm leading-relaxed">
            {draft.subject && <p className="font-semibold">{draft.subject}</p>}
            <p className="whitespace-pre-line">{draft.note}</p>
          </blockquote>
        )
      )}

      {error && <Alert className="mt-3">{error}</Alert>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="fill"
          disabled={pending}
          onClick={() => resolve.mutate({ id: s.id, action: "approve", draft })}
        >
          {pending && resolve.variables?.action === "approve" ? "Working" : approveLabel[s.kind]}
        </Button>
        {canEdit && (
          <Button onClick={() => setEditing((e) => !e)} disabled={pending} aria-expanded={editing}>
            {editing ? "Done editing" : "Edit"}
          </Button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => resolve.mutate({ id: s.id, action: "dismiss" })}
          className="min-h-10 px-2 text-[13px] text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50 pointer-coarse:min-h-11"
        >
          Not now
        </button>
      </div>
    </article>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={props.id} className="text-xs font-semibold">
        {props.label}
      </label>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => {
          // The server checks the range; clamping here would fight the user mid-typing.
          if (e.target.value !== "") props.onChange(Math.round(Number(e.target.value)));
        }}
        className="num w-28 border-[1.5px] border-field bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}
