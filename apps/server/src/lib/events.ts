import type { ServerEvent } from "@milestone/shared";

type Listener = (event: ServerEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(event: ServerEvent): void {
  for (const fn of listeners) fn(event);
}
