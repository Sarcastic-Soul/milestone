import type { ProjectDetail } from "@milestone/shared";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  ClockIcon,
  PaperPlaneTiltIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense } from "react";
import { Alert } from "../components/Alert.tsx";
import { Button } from "../components/Button.tsx";
import { Suggestions } from "../components/Suggestions.tsx";
import { useProject, useSendInvoice } from "../lib/api.ts";
import { daysBetween, lastDay, longDate, money, shortDate, timeAgo, todayIso } from "../lib/format.ts";
import { linkProps } from "../lib/router.ts";

type Milestone = ProjectDetail["milestones"][number];

// Bryntum is most of the bundle, so it only loads when a project is opened.
const ProjectGantt = lazy(() => import("../components/ProjectGantt.tsx").then((m) => ({ default: m.ProjectGantt })));

export function ProjectPage({ id }: { id: string }) {
  const { data: project, isPending, error } = useProject(id);

  if (isPending) return <ProjectSkeleton />;
  if (error || !project) {
    return (
      <div className="px-4 py-16 md:px-10">
        <h1 className="font-display text-4xl">This project could not be loaded</h1>
        <p className="mt-3 text-ink-2">{error?.message ?? "It may have been deleted."}</p>
        <a {...linkProps("/")} className="mt-4 inline-block underline underline-offset-4">
          Back to projects
        </a>
      </div>
    );
  }

  const today = todayIso();
  const collected = project.milestones.filter((m) => m.status === "paid").reduce((t, m) => t + m.amount, 0);
  const overdue = project.milestones.filter((m) => m.status === "sent" && m.dueDate && m.dueDate < today);
  const end = project.phases.at(-1)?.endDate;
  const share = project.total > 0 ? Math.min(100, (collected / project.total) * 100) : 0;

  return (
    <div className="flex flex-1 flex-col">
      <section className="grid gap-6 px-4 pt-8 pb-7 md:grid-cols-[1fr_auto] md:items-end md:gap-10 md:px-10 md:pt-10">
        <div>
          <h1 className="max-w-[18ch] font-display text-4xl leading-[1.04] tracking-tight md:text-[52px]">
            {project.name}
          </h1>
          <p className="mt-3 text-sm text-ink-2">
            {project.clientName}, <a href={`mailto:${project.clientEmail}`} className="underline-offset-4 hover:underline pointer-coarse:inline-block pointer-coarse:py-2">{project.clientEmail}</a>
          </p>
          <p className="text-sm text-ink-2">
            {longDate(project.startDate)} to {end ? longDate(lastDay(end)) : "not set"}
          </p>
        </div>
        <div className="md:text-right">
          <div className="font-display text-5xl leading-none tracking-tight tabular-nums md:text-[64px]">
            {money(collected, project.currency)}
          </div>
          <div className="mt-2 text-sm text-ink-2">
            collected of <span className="num">{money(project.total, project.currency)}</span>
          </div>
          <div className="mt-3 h-1.5 w-full bg-paper-3 md:ml-auto md:w-64" aria-hidden>
            <div
              className="h-full origin-left bg-accent transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${share / 100})` }}
            />
          </div>
          {overdue.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-late md:justify-end">
              <WarningIcon weight="bold" aria-hidden />
              <span className="num">{money(overdue.reduce((t, m) => t + m.amount, 0), project.currency)}</span> overdue
            </div>
          )}
        </div>
      </section>

      <Suggestions project={project} />

      <div className="grid flex-1 border-t border-rule lg:grid-cols-[1fr_360px]">
        {/* Bryntum needs a real height: header plus one 84px row per phase, plus room for the last money line. */}
        <div className="min-w-0">
          <div style={{ height: 52 + project.phases.length * 84 + 24 }}>
            <Suspense fallback={<div className="h-full animate-pulse bg-paper-2 motion-reduce:animate-none" />}>
              <ProjectGantt project={project} />
            </Suspense>
          </div>
          <div className="border-t border-rule px-4 py-7 md:px-10">
            <Activity project={project} />
          </div>
        </div>
        <aside className="border-t border-rule bg-paper-2 px-4 py-7 md:px-8 lg:border-t-0 lg:border-l">
          <Payments project={project} />
          {project.payouts.length > 0 && <Payouts project={project} />}
        </aside>
      </div>
    </div>
  );
}

function Payments({ project }: { project: ProjectDetail }) {
  const send = useSendInvoice(project.id);
  const phaseName = (m: Milestone) => project.phases.find((p) => p.id === m.phaseId)?.name;

  return (
    <section>
      <h2 className="font-display text-[26px] leading-tight">Payments</h2>
      <p className="mb-4 text-[13px] text-ink-2">Invoices go out through PayPal. Paid ones unlock the next phase.</p>
      {send.error && (
        <Alert className="mb-3">{send.error.message}</Alert>
      )}
      <ul>
        {project.milestones.map((m) => (
          <li key={m.id} className={`border-t border-rule py-3.5 ${m.status === "cancelled" ? "text-ink-2" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{m.label}</span>
              <span className={`num ${m.status === "cancelled" ? "line-through" : ""}`}>{money(m.amount, project.currency)}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-2">
              {phaseName(m)}
              {m.dueDate && `, due ${shortDate(m.dueDate)}`}
            </div>
            <div className="mt-2">
              <MilestoneAction
                milestone={m}
                currency={project.currency}
                sending={send.isPending && send.variables === m.id}
                disabled={send.isPending}
                onSend={() => send.mutate(m.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MilestoneAction(props: {
  milestone: Milestone;
  currency: string;
  sending: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  const { milestone: m } = props;
  const today = todayIso();

  if (m.status === "paid") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-accent">
          <CheckIcon weight="bold" aria-hidden /> Paid
        </span>
        {m.netAmount !== null && (
          <span className="text-ink-2">
            <span className="num text-ink">{money(m.netAmount, props.currency)}</span> to you after{" "}
            <span className="num">{money(m.paypalFee ?? 0, props.currency)}</span> PayPal fee
          </span>
        )}
      </div>
    );
  }
  if (m.status === "pending") {
    return (
      <Button onClick={props.onSend} disabled={props.disabled}>
        <PaperPlaneTiltIcon weight="bold" aria-hidden />
        {props.sending ? "Sending" : "Send invoice"}
      </Button>
    );
  }
  if (m.status === "sent") {
    const late = m.dueDate && m.dueDate < today ? daysBetween(m.dueDate, today) : 0;
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span className={`inline-flex items-center gap-1.5 ${late ? "font-semibold text-late" : "text-ink-2"}`}>
          <ClockIcon weight="bold" aria-hidden />
          {late ? `${late} ${late === 1 ? "day" : "days"} late` : "Sent, waiting for payment"}
        </span>
        {m.payerUrl && (
          <a
            href={m.payerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:underline pointer-coarse:py-2"
          >
            Open in PayPal <ArrowSquareOutIcon aria-hidden />
          </a>
        )}
      </div>
    );
  }
  if (m.status === "partially_paid") {
    return (
      <span className="text-[13px] font-semibold text-late">
        <span className="num">{money(m.amountPaid, props.currency)}</span> paid so far
      </span>
    );
  }
  if (m.status === "cancelled") {
    return <span className="text-[13px] text-ink-2">Cancelled</span>;
  }
  return <span className="text-[13px] font-semibold text-late">Refunded</span>;
}

function Payouts({ project }: { project: ProjectDetail }) {
  const phaseName = (id: string | null) => project.phases.find((p) => p.id === id)?.name;
  return (
    <section className="mt-9">
      <h2 className="font-display text-[26px] leading-tight">Payouts</h2>
      <p className="mb-4 text-[13px] text-ink-2">What you owe people who helped.</p>
      <ul>
        {project.payouts.map((p) => (
          <li key={p.id} className="border-t border-rule py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{p.name}</span>
              <span className="num">{money(p.amount, project.currency)}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-ink-2">
              {phaseName(p.phaseId) ?? "Project"}: {p.trigger}
            </div>
            <PayoutState status={p.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const PAYOUT_STATE: Record<ProjectDetail["payouts"][number]["status"], [string, string]> = {
  pending: ["Not paid yet", "text-ink-2"],
  sent: ["Sent, PayPal is processing it", "text-ink-2"],
  success: ["Paid through PayPal", "font-semibold text-accent"],
  unclaimed: ["Sent, not claimed yet", "font-semibold text-late"],
  failed: ["Payout failed", "font-semibold text-late"],
};

function PayoutState({ status }: { status: ProjectDetail["payouts"][number]["status"] }) {
  const [text, cls] = PAYOUT_STATE[status];
  return (
    <div className={`mt-2 inline-flex items-center gap-1.5 text-[13px] ${cls}`}>
      {status === "success" && <CheckIcon weight="bold" aria-hidden />}
      {text}
    </div>
  );
}

function Activity({ project }: { project: ProjectDetail }) {
  return (
    <section className="max-w-3xl">
      <h2 className="font-display text-[26px] leading-tight">Activity</h2>
      {project.activity.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">Nothing yet. Sent invoices and PayPal payments show up here.</p>
      ) : (
        <ol className="mt-3">
          {project.activity.map((a) => (
            <li key={a.id} className="grid gap-x-6 border-t border-rule py-3 sm:grid-cols-[140px_1fr]">
              <time dateTime={a.at} className="pt-0.5 text-xs text-ink-2">
                {timeAgo(a.at)}
              </time>
              <p className={`text-sm ${a.kind === "warning" ? "text-late" : ""}`}>{a.message}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ProjectSkeleton() {
  return (
    <div className="animate-pulse px-4 pt-10 motion-reduce:animate-none md:px-10" role="status">
      <span className="sr-only">Loading project</span>
      <div className="h-12 w-2/3 max-w-xl bg-paper-3" />
      <div className="mt-4 h-4 w-64 bg-paper-3" />
      <div className="mt-12 grid gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-paper-2" />
        ))}
      </div>
    </div>
  );
}
