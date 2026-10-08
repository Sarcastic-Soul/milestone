import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "fill" | "line" };

// Square, bordered buttons to match the ledger look. "fill" is the one main action on a screen.
export function Button({ variant = "line", className = "", ...props }: Props) {
  const look =
    variant === "fill"
      ? "bg-ink text-paper border-ink hover:bg-accent hover:border-accent"
      : "bg-transparent text-ink border-ink hover:bg-paper-3";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-10 items-center gap-2 border-[1.5px] px-3.5 py-2 pointer-coarse:min-h-11 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
    />
  );
}
