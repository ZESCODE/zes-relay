import { cn, fmtMs } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import type { RowTestState } from "@/lib/types";

export interface TestBadgeProps {
  state?: RowTestState;
  className?: string;
}

/** ✅ ok + latency · ❌ status + error tooltip · ⏳ running · – untested */
export function TestBadge({ state, className }: TestBadgeProps) {
  if (!state || state.status === "idle") {
    if (state?.error) {
      return (
        <Badge tone="red" className={className} title={state.error}>
          ⚠ error
        </Badge>
      );
    }
    return (
      <span className={cn("text-xs text-[var(--frost-muted)]", className)}>not tested</span>
    );
  }

  if (state.status === "running") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-amber-300",
          className,
        )}
      >
        <Spinner size={12} label="Testing model" />
        testing…
      </span>
    );
  }

  const result = state.result;
  if (!result) return <span className={cn("text-xs text-[var(--frost-muted)]", className)}>–</span>;

  const tone: BadgeTone = result.ok ? "green" : "red";
  const label = result.ok ? `✓ ${fmtMs(result.latency_ms)}` : `✕ ${result.status || "timeout"}`;
  const tooltip = result.ok
    ? `Healthy in ${fmtMs(result.latency_ms)} · ${new Date(result.ts).toLocaleTimeString()}`
    : `${result.status || "no response"} · ${result.error || "unknown error"}`;

  return (
    <Badge tone={tone} className={className} title={tooltip}>
      <span className="tabular-nums">{label}</span>
    </Badge>
  );
}
