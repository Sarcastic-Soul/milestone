import { useSyncExternalStore } from "react";

// A tiny history router: three routes don't need a library.
type Route = { name: "projects" } | { name: "new" } | { name: "project"; id: string } | { name: "missing" };

function match(path: string): Route {
  if (path === "/" || path === "") return { name: "projects" };
  if (path === "/new") return { name: "new" };
  const project = path.match(/^\/p\/([0-9a-f-]{36})$/);
  if (project) return { name: "project", id: project[1]! };
  return { name: "missing" };
}

function subscribe(fn: () => void) {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  return match(path);
}

export function navigate(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

// Use for plain left clicks on internal links so they don't reload the page.
export function linkProps(path: string) {
  return {
    href: path,
    onClick: (e: React.MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(path);
    },
  };
}
