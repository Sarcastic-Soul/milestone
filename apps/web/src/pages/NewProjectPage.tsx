import type { PlanDraft } from "@milestone/shared";
import { ArrowCounterClockwiseIcon, FileArrowUpIcon, SparkleIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Alert } from "../components/Alert.tsx";
import { Button } from "../components/Button.tsx";
import { type Draft, useDraftPlan, useSaveProject } from "../lib/api.ts";
import { daysBetween, lastDay, money, shortDate, weeksLabel } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";

const SAMPLE = `Statement of Work: Brightleaf Bakery website redesign
Client: Brightleaf Bakery (owner: Maria Lopez, maria@brightleaf.example)
Freelancer: Dev Studio. Start date: 2026-11-02. Total fee: USD 4,800.
Phase 1 Discovery & wireframes - 1 week. 20% deposit due at signing.
Phase 2 Visual design - 2 weeks, starts after Phase 1. 30% due on approval of designs.
Phase 3 Build (Next.js + online ordering) - 3 weeks, starts after Phase 2 payment clears. 40% due on launch.
Phase 4 Launch & 2 weeks support. Remaining 10% due at end of support.
Subcontractor: Priya (illustrations, priya@studio.example) paid USD 600 when Phase 2 designs are approved.`;

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

export function NewProjectPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const read = useDraftPlan();
  const save = useSaveProject();
  const reduce = useReducedMotion();

  const canRead = (text.trim().length > 0 || file !== null) && !read.isPending;

  function readContract(input: { text?: string; file?: File }) {
    setDraft(null);
    read.mutate(input, { onSuccess: setDraft });
  }

  function create() {
    if (!draft) return;
    save.mutate(draft, { onSuccess: ({ id }) => navigate(`/p/${id}`) });
  }

  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="border-rule px-4 py-8 md:px-10 md:py-10 lg:border-r">
        <h1 className="font-display text-4xl tracking-tight md:text-[52px]">New project</h1>
        <p className="mt-3 max-w-[48ch] text-ink-2">
          Paste the contract or upload it. Milestone reads the phases and payments, and you check them before anything
          is saved.
        </p>

        <form
          className="mt-8 grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canRead) readContract({ text: text.trim() || undefined, file: file ?? undefined });
          }}
        >
          <div className="grid gap-2">
            <label htmlFor="contract" className="text-sm font-semibold">
              Contract text
            </label>
            <textarea
              id="contract"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={11}
              className="w-full resize-y border-[1.5px] border-field bg-paper px-3 py-2.5 text-sm leading-relaxed placeholder:text-ink-2/80 focus:border-ink focus:outline-none"
              placeholder="Statement of work, scope, payment terms..."
            />
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-semibold">Or upload a file</span>
            {file ? (
              <div className="flex items-center justify-between gap-3 border-[1.5px] border-ink px-3 py-2.5 text-sm">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="inline-flex items-center gap-1 text-ink-2 hover:text-ink pointer-coarse:py-2"
                >
                  <XIcon aria-hidden /> Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 border-[1.5px] border-dashed border-field px-3 py-3 text-sm text-ink-2 hover:border-ink hover:text-ink has-focus-visible:border-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent">
                <FileArrowUpIcon size={20} aria-hidden />
                PDF, PNG, JPEG or WebP, up to 10 MB
                <input
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const picked = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (picked && picked.size > MAX_BYTES) {
                      setFileError(`${picked.name} is over 10 MB. Try a smaller file or paste the text instead.`);
                      return;
                    }
                    setFileError(null);
                    setFile(picked);
                  }}
                />
              </label>
            )}
            {fileError && <Alert>{fileError}</Alert>}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="fill" disabled={!canRead}>
              <SparkleIcon weight="bold" aria-hidden />
              {read.isPending ? "Reading contract" : "Read contract"}
            </Button>
            <Button
              disabled={read.isPending}
              onClick={() => {
                setText(SAMPLE);
                setFile(null);
                readContract({ text: SAMPLE });
              }}
            >
              Try the sample contract
            </Button>
          </div>
          {read.error && <Alert>{read.error.message}</Alert>}
        </form>
      </section>

      <section className="border-t border-rule bg-paper-2 px-4 py-8 md:px-10 md:py-10 lg:border-t-0" aria-live="polite">
        <AnimatePresence mode="wait">
          {read.isPending ? (
            <motion.div key="loading" exit={{ opacity: 0 }}>
              <ReadingSkeleton />
            </motion.div>
          ) : draft ? (
            <motion.div
              key="draft"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <DraftReview
                plan={draft.plan}
                onChange={(plan) => setDraft({ ...draft, plan })}
                onCreate={create}
                onReset={() => setDraft(null)}
                saving={save.isPending}
                error={save.error?.message}
              />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={false} exit={{ opacity: 0 }} className="max-w-md pt-2">
              <h2 className="font-display text-[26px] leading-tight">The plan shows up here</h2>
              <p className="mt-2 text-sm text-ink-2">
                You'll see each phase with its dates, each payment with its amount and due date, and anyone you need to
                pay along the way. Nothing is saved or sent until you create the project.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

function DraftReview(props: {
  plan: PlanDraft;
  onChange: (plan: PlanDraft) => void;
  onCreate: () => void;
  onReset: () => void;
  saving: boolean;
  error?: string;
}) {
  const { plan } = props;
  const end = plan.phases.at(-1)?.endDate;
  const set = (patch: Partial<PlanDraft>) => props.onChange({ ...plan, ...patch });

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="grid gap-2">
          <label htmlFor="pname" className="text-sm font-semibold">
            Project name
          </label>
          <input
            id="pname"
            value={plan.projectName}
            onChange={(e) => set({ projectName: e.target.value })}
            className="border-b-[1.5px] border-field bg-transparent pb-1 font-display text-3xl leading-tight focus:border-ink focus:outline-none"
          />
        </div>
        <div className="md:text-right">
          <div className="num text-3xl">{money(plan.total, plan.currency)}</div>
          <div className="text-sm text-ink-2">
            {shortDate(plan.startDate)}
            {end && ` to ${shortDate(lastDay(end))}`}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Client name" id="cname" value={plan.client.name} onChange={(name) => set({ client: { ...plan.client, name } })} />
        <Field
          label="Client email (gets the PayPal invoices)"
          id="cemail"
          type="email"
          value={plan.client.email}
          onChange={(email) => set({ client: { ...plan.client, email } })}
        />
      </div>

      {plan.warnings.length > 0 && (
        <ul className="mt-6 grid gap-1 border border-late/35 bg-late-soft px-3 py-2 text-sm text-late">
          {plan.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <WarningIcon className="mt-[3px] shrink-0" weight="bold" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-9 font-display text-xl">Phases</h3>
      <ol className="mt-2">
        {plan.phases.map((p, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-rule py-3 text-sm">
            <span className="font-semibold">{p.name}</span>
            <span className="text-right tabular-nums">
              {shortDate(p.startDate)} to {shortDate(lastDay(p.endDate))}
            </span>
            <span className="text-ink-2">
              {weeksLabel(daysBetween(p.startDate, p.endDate))}
              {p.waitForPayment && ", starts once the previous payment is in"}
            </span>
          </li>
        ))}
      </ol>

      <h3 className="mt-9 font-display text-xl">Payments from {plan.client.name || "the client"}</h3>
      <ol className="mt-2">
        {plan.milestones.map((m, i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-rule py-3 text-sm">
            <span className="font-semibold">{m.label}</span>
            <span className="num text-right">{money(m.amount, plan.currency)}</span>
            <span className="text-ink-2">
              {plan.phases[m.phaseIndex]?.name}, due {shortDate(m.dueDate)}
            </span>
          </li>
        ))}
      </ol>

      {plan.payouts.length > 0 && (
        <>
          <h3 className="mt-9 font-display text-xl">Payouts you'll send</h3>
          <ol className="mt-2">
            {plan.payouts.map((p, i) => (
              <li key={i} className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-rule py-3 text-sm">
                <span className="font-semibold">{p.name}</span>
                <span className="num text-right">{money(p.amount, plan.currency)}</span>
                <span className="text-ink-2">{p.trigger}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mt-9 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Button variant="fill" onClick={props.onCreate} disabled={props.saving}>
          {props.saving ? "Creating" : "Create project"}
        </Button>
        <Button onClick={props.onReset} disabled={props.saving}>
          <ArrowCounterClockwiseIcon weight="bold" aria-hidden /> Start over
        </Button>
        <span className="text-[13px] text-ink-2">No invoices are sent yet. You send each one when it's due.</span>
      </div>
      {props.error && <Alert className="mt-4">{props.error}</Alert>}
    </div>
  );
}

function Field(props: { label: string; id: string; value: string; type?: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={props.id} className="text-sm font-semibold">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="border-[1.5px] border-field bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function ReadingSkeleton() {
  return (
    <div role="status">
      <p className="text-sm text-ink-2">Reading the contract. This usually takes 5 to 15 seconds.</p>
      <div className="mt-6 h-9 w-2/3 animate-pulse bg-paper-3 motion-reduce:animate-none" />
      <div className="mt-8 grid gap-px">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse bg-paper-3/70 motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}
