import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import { BryntumGantt, BryntumGanttProjectModel } from "@bryntum/gantt-react";
import { useRef } from "react";

// Placeholder data until projects come from the API.
const tasks = [
  { id: 1, name: "Discovery & wireframes", startDate: "2026-11-02", duration: 7 },
  { id: 2, name: "Visual design", startDate: "2026-11-09", duration: 14 },
  { id: 3, name: "Build", startDate: "2026-11-23", duration: 21 },
  { id: 4, name: "Launch & support", startDate: "2026-12-14", duration: 14 },
];

const dependencies = [
  { id: 1, from: 1, to: 2 },
  { id: 2, from: 2, to: 3 },
  { id: 3, from: 3, to: 4 },
];

export function ProjectGantt() {
  const projectRef = useRef<BryntumGanttProjectModel>(null);

  return (
    <>
      <BryntumGanttProjectModel ref={projectRef} startDate="2026-11-02" tasks={tasks} dependencies={dependencies} />
      <BryntumGantt
        project={projectRef}
        columns={[{ type: "name", field: "name", width: 240 }]}
        viewPreset="weekAndDayLetter"
        barMargin={8}
      />
    </>
  );
}
