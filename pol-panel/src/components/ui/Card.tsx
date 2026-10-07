import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/format";

export type FrostTone = "neutral" | "green" | "blue" | "orange" | "red" | "violet";

const TONES: Record<FrostTone, string> = {
  neutral: "glass-card",
  green: "glass-card frost-green",
  blue: "glass-card frost-blue",
  orange: "glass-card frost-orange",
  red: "glass-card frost-red",
  violet: "glass-card frost-violet",
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: FrostTone;
}

export function Card({ tone = "neutral", className, children, ...rest }: CardProps) {
  return (
    <div className={cn(TONES[tone], "p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, actions, icon, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3 mb-3", className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon ? <span className="mt-0.5 shrink-0 text-[var(--frost-muted)]">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight truncate">{title}</h2>
          {subtitle ? (
            <p className="text-xs text-[var(--frost-muted)] mt-0.5 break-words">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-1.5 shrink-0">{actions}</div> : null}
    </div>
  );
}
