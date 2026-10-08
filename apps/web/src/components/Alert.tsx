import { WarningIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

// Inline error or warning. Rust is the only "something is wrong" color in the app.
export function Alert({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`flex gap-2 border border-late/35 bg-late-soft px-3 py-2 text-sm text-late ${className}`}>
      <WarningIcon className="mt-[3px] shrink-0" weight="bold" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
