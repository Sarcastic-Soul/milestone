import type { ProjectDetail } from "@milestone/shared";

export type PhaseState = "done" | "active" | "blocked" | "planned";

// The server stores "blocked" or "planned"; done and in-progress come from today's date.
export function phaseState(phase: ProjectDetail["phases"][number], today: string): PhaseState {
  if (phase.status === "blocked") return "blocked";
  if (phase.status === "done" || phase.endDate <= today) return "done";
  if (phase.startDate <= today) return "active";
  return "planned";
}
