import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import type { DomConfig, Model } from "@bryntum/gantt";
import { BryntumGantt, BryntumGanttProjectModel } from "@bryntum/gantt-react";
import type { ProjectDetail } from "@milestone/shared";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { daysBetween, money, shortDate, todayIso, weeksLabel } from "../lib/format.ts";
import { phaseState, type PhaseState } from "../lib/status.ts";

type Phase = ProjectDetail["phases"][number];
type Milestone = ProjectDetail["milestones"][number];

const BAR_TEXT: Record<PhaseState, string> = {
  done: "Done",
  active: "In progress",
  blocked: "On hold until paid",
  planned: "",
};

// One line per invoice under the bar: "Deposit $960 paid", "Design $1,440 3 days late".
function moneyLine(milestones: Milestone[], currency: string): DomConfig[] {
  const today = todayIso();
  return milestones.map((m, i) => {
    let state = m.dueDate ? `due ${shortDate(m.dueDate)}` : "";
    let cls = "";
    if (m.status === "paid") {
      state = "paid";
      cls = "money-paid";
    } else if (m.status === "sent" && m.dueDate && m.dueDate < today) {
      const late = daysBetween(m.dueDate, today);
      state = late === 1 ? "1 day late" : `${late} days late`;
      cls = "money-late";
    } else if (m.status === "sent") {
      state = `sent, due ${shortDate(m.dueDate ?? today)}`;
    }
    return {
      tag: "span",
      className: cls,
      style: i > 0 ? { marginLeft: "14px" } : undefined,
      children: [
        { tag: "span", text: `${m.label} ` },
        { tag: "span", className: "money-amount", text: money(m.amount, currency) },
        { tag: "span", text: ` ${state}` },
      ],
    };
  });
}

const NARROW = "(max-width: 640px)";
function useNarrow() {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => window.matchMedia(NARROW).matches,
  );
}

export function ProjectGantt({ project }: { project: ProjectDetail }) {
  const projectRef = useRef<BryntumGanttProjectModel>(null);
  const narrow = useNarrow();

  const byPhase = useMemo(() => {
    const map = new Map<string, Milestone[]>();
    for (const m of project.milestones) {
      if (!m.phaseId) continue;
      map.set(m.phaseId, [...(map.get(m.phaseId) ?? []), m]);
    }
    return map;
  }, [project.milestones]);

  const data = useMemo(() => {
    const today = todayIso();
    const tasks = project.phases.map((p: Phase) => {
      const state = phaseState(p, today);
      return {
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        endDate: p.endDate,
        // Dates come from the server; the payment rules move them, not the Gantt engine.
        manuallyScheduled: true,
        cls: `phase-${state}`,
        state,
        waitForPayment: p.waitForPayment,
        days: daysBetween(p.startDate, p.endDate),
      };
    });
    const dependencies = project.phases.slice(1).map((p, i) => ({ id: `d${i}`, from: project.phases[i]!.id, to: p.id }));
    return { tasks, dependencies };
  }, [project.phases]);

  // Load new data in place when a webhook changes the project, instead of remounting the chart.
  useEffect(() => {
    const instance = projectRef.current?.instance;
    if (!instance) return;
    instance.loadInlineData({ tasks: data.tasks, dependencies: data.dependencies });
  }, [data]);

  const range = useMemo(() => {
    const starts = project.phases.map((p) => p.startDate).sort();
    const ends = project.phases.map((p) => p.endDate).sort();
    const start = new Date(`${starts[0] ?? project.startDate}T00:00:00`);
    const end = new Date(`${ends.at(-1) ?? project.startDate}T00:00:00`);
    start.setDate(start.getDate() - 2);
    end.setDate(end.getDate() + 7);
    // Open the chart at the first phase that still has work or money outstanding, so a late
    // invoice is the first thing in view, even on a phone.
    const today = todayIso();
    const owed = new Set(project.milestones.filter((m) => m.status !== "paid").map((m) => m.phaseId));
    const focus = project.phases.find((p) => phaseState(p, today) !== "done" || owed.has(p.id));
    let visible;
    if (focus && focus.startDate > (starts[0] ?? "")) {
      const date = new Date(`${focus.startDate}T00:00:00`);
      date.setDate(date.getDate() - 3);
      visible = { date, block: "start" as const };
    }
    return { start, end, visible };
  }, [project.phases, project.milestones, project.startDate]);

  return (
    <>
      <BryntumGanttProjectModel ref={projectRef} tasks={data.tasks} dependencies={data.dependencies} />
      <BryntumGantt
        project={projectRef}
        cls="ledger-gantt"
        readOnly
        rowHeight={84}
        barMargin={18}
        startDate={range.start}
        endDate={range.end}
        visibleDate={range.visible}
        viewPreset={{
          // One tick per week; on wide screens Bryntum stretches it, on phones the timeline scrolls.
          tickWidth: 76,
          shiftUnit: "week",
          shiftIncrement: 1,
          timeResolution: { unit: "day", increment: 1 },
          headers: [{ unit: "week", dateFormat: "D MMM" }],
        }}
        subGridConfigs={{ locked: { width: narrow ? 150 : 240 } }}
        columns={[
          {
            type: "name",
            field: "name",
            text: "Phase",
            flex: 1,
            renderer: ({ record }: { record: Model }) => {
              const days = record.getData("days") as number;
              const waits = record.getData("waitForPayment") as boolean;
              return {
                children: [
                  { className: "phase-name", text: record.getData("name") as string },
                  { className: "phase-sub", text: weeksLabel(days) + (waits ? ", waits for payment" : "") },
                ],
              };
            },
          },
        ]}
        taskRenderer={({ taskRecord }) => BAR_TEXT[taskRecord.getData("state") as PhaseState] ?? ""}
        labelsFeature={{
          bottom: {
            renderer: ({ taskRecord, domConfig }) => {
              domConfig.children = moneyLine(byPhase.get(String(taskRecord.id)) ?? [], project.currency);
            },
          },
        }}
        timeRangesFeature={{ showCurrentTimeLine: { name: "Today" } }}
        taskMenuFeature={false}
        cellMenuFeature={false}
        headerMenuFeature={false}
        timeAxisHeaderMenuFeature={false}
        taskTooltipFeature={false}
        sortFeature={false}
        columnReorderFeature={false}
        projectLinesFeature={false}
        percentBarFeature={false}
      />
    </>
  );
}
