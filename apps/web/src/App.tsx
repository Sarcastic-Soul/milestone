import { ProjectGantt } from "./ProjectGantt.tsx";
import { useServerEvents } from "./useServerEvents.ts";

export function App() {
  const { connected, events } = useServerEvents();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-semibold">Milestone</h1>
        <span className="text-sm">
          {connected ? "Live" : "Offline"} · {events.length} PayPal events
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <ProjectGantt />
      </main>
    </div>
  );
}
