import { ArrowRightIcon, FileTextIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Alert } from "../components/Alert.tsx";
import { Button } from "../components/Button.tsx";
import { useProjects } from "../lib/api.ts";
import { lastDay, money, shortDate } from "../lib/format.ts";
import { linkProps, navigate } from "../lib/router.ts";

export function ProjectsPage() {
  const { data: projects, isPending, error } = useProjects();
  const reduce = useReducedMotion();

  return (
    <div className="px-4 py-8 md:px-10 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl tracking-tight md:text-[52px]">Projects</h1>
        {projects && projects.length > 0 && (
          <Button variant="fill" onClick={() => navigate("/new")}>
            <FileTextIcon weight="bold" aria-hidden /> New project from contract
          </Button>
        )}
      </div>

      {isPending && (
        <div className="mt-8 grid gap-px" role="status">
          <span className="sr-only">Loading projects</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse bg-paper-2 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {error && (
        <Alert className="mt-8">Could not load projects: {error.message}</Alert>
      )}

      {projects?.length === 0 && (
        <div className="mt-10 max-w-xl border-t border-rule pt-10">
          <h2 className="font-display text-3xl leading-tight">No projects yet</h2>
          <p className="mt-3 text-ink-2">
            Paste a contract or upload it as a PDF. Milestone reads it, builds the schedule, and sets up a PayPal invoice
            for each payment in it.
          </p>
          <Button variant="fill" className="mt-6" onClick={() => navigate("/new")}>
            <FileTextIcon weight="bold" aria-hidden /> Start from a contract
          </Button>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="mt-8 border-b border-rule">
          {projects.map((p, i) => {
            const share = p.total > 0 ? (p.collected / p.total) * 100 : 0;
            return (
              <motion.li
                key={p.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="border-t border-rule"
              >
                <a
                  {...linkProps(`/p/${p.id}`)}
                  className="group grid gap-3 py-5 md:grid-cols-[1fr_200px_220px_24px] md:items-center md:gap-8"
                >
                  <div>
                    <div className="font-display text-2xl leading-tight group-hover:underline group-hover:underline-offset-4">
                      {p.name}
                    </div>
                    <div className="mt-1 text-sm text-ink-2">
                      {p.clientName}, {shortDate(p.startDate)}
                      {p.endDate && ` to ${shortDate(lastDay(p.endDate))}`}
                    </div>
                  </div>
                  <div className="text-sm">
                    {p.overdue > 0 ? (
                      <span className="font-semibold text-late">
                        <span className="num">{money(p.overdue, p.currency)}</span> overdue
                      </span>
                    ) : p.blockedPhases > 0 ? (
                      <span className="text-ink-2">Next phase waits for payment</span>
                    ) : p.collected >= p.total ? (
                      <span className="text-accent">Fully paid</span>
                    ) : (
                      <span className="text-ink-2">On schedule</span>
                    )}
                  </div>
                  <div>
                    <div className="text-sm">
                      <span className="num">{money(p.collected, p.currency)}</span>
                      <span className="text-ink-2"> of </span>
                      <span className="num">{money(p.total, p.currency)}</span>
                    </div>
                    <div className="mt-2 h-1 bg-paper-3" aria-hidden>
                      <div className="h-full bg-accent" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                  <ArrowRightIcon
                    className="hidden text-ink-2 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink md:block"
                    aria-hidden
                  />
                </a>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
