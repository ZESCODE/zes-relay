import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { Card, type FrostTone } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: FrostTone;
  icon?: IconName;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  className?: string;
  footer?: ReactNode;
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
  trend,
  className,
  footer,
}: StatTileProps) {
  return (
    <Card tone={tone} className={cn("p-3.5 sm:p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wider text-[var(--frost-muted)] font-medium">
          {label}
        </p>
        {icon ? (
          <span className="text-[var(--frost-muted)]">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-2xl sm:text-3xl font-semibold tabular-nums leading-none break-all">
        {value}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--frost-muted)]">
        {sub ? <span className="truncate">{sub}</span> : null}
        {trend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              trend.direction === "up" && "text-emerald-300",
              trend.direction === "down" && "text-red-300",
            )}
          >
            <Icon
              name={trend.direction === "up" ? "arrowUp" : trend.direction === "down" ? "arrowDown" : "clock"}
              size={12}
            />
            {trend.label}
          </span>
        ) : null}
      </div>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </Card>
  );
}
