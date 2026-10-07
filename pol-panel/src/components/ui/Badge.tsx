import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

export type BadgeTone = "neutral" | "green" | "blue" | "orange" | "red" | "violet";

const TONES: Record<BadgeTone, string> = {
  neutral: "glass-badge text-[var(--frost-muted)]",
  green: "glass-badge bg-emerald-500/15 border-emerald-400/40 text-emerald-300",
  blue: "glass-badge bg-blue-500/15 border-blue-400/40 text-blue-300",
  orange: "glass-badge bg-amber-500/15 border-amber-400/40 text-amber-300",
  red: "glass-badge bg-red-500/15 border-red-400/40 text-red-300",
  violet: "glass-badge bg-violet-500/15 border-violet-400/40 text-violet-300",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(TONES[tone], "inline-flex items-center gap-1.5", className)} {...rest}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "green" && "bg-emerald-400",
            tone === "blue" && "bg-blue-400",
            tone === "orange" && "bg-amber-400",
            tone === "red" && "bg-red-400",
            tone === "violet" && "bg-violet-400",
            tone === "neutral" && "bg-slate-400",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
