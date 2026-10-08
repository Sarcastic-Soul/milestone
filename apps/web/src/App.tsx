import { linkProps, useRoute } from "./lib/router.ts";
import { useServerEvents } from "./lib/useServerEvents.ts";
import { NewProjectPage } from "./pages/NewProjectPage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";

export function App() {
  const route = useRoute();
  const { connected } = useServerEvents();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center gap-7 border-b border-rule px-4 md:px-10">
        <a {...linkProps("/")} className="font-display text-xl font-semibold tracking-tight pointer-coarse:py-2">
          Milestone
        </a>
        <nav className="flex gap-5 text-sm">
          <a
            {...linkProps("/")}
            aria-current={route.name === "projects" || route.name === "project" ? "page" : undefined}
            className="border-b-2 border-transparent py-1 text-ink-2 pointer-coarse:py-3 hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink"
          >
            Projects
          </a>
          <a
            {...linkProps("/new")}
            aria-current={route.name === "new" ? "page" : undefined}
            className="border-b-2 border-transparent py-1 text-ink-2 pointer-coarse:py-3 hover:text-ink aria-[current=page]:border-ink aria-[current=page]:text-ink"
          >
            New project
          </a>
        </nav>
        <span
          className="ml-auto hidden items-center gap-2 text-xs text-ink-2 sm:flex"
          title={connected ? "PayPal updates show up here as they arrive" : "Reconnecting to the server"}
        >
          <span className={`size-2 ${connected ? "bg-accent" : "bg-rule"}`} aria-hidden />
          {connected ? "Live PayPal updates" : "Reconnecting"}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        {route.name === "projects" && <ProjectsPage />}
        {route.name === "new" && <NewProjectPage />}
        {route.name === "project" && <ProjectPage id={route.id} key={route.id} />}
        {route.name === "missing" && (
          <div className="px-4 py-16 md:px-10">
            <h1 className="font-display text-4xl">Page not found</h1>
            <a {...linkProps("/")} className="mt-4 inline-block underline underline-offset-4">
              Back to projects
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
