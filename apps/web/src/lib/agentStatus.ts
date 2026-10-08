import { useSyncExternalStore } from "react";

// Which projects the agent is looking at right now, fed by the server's live feed.
const running = new Set<string>();
const listeners = new Set<() => void>();

export function setAgentRunning(projectId: string, isRunning: boolean) {
  if (isRunning) running.add(projectId);
  else running.delete(projectId);
  for (const fn of listeners) fn();
}

export function useAgentRunning(projectId: string) {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => running.has(projectId),
  );
}
