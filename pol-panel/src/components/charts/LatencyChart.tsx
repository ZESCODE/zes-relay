import { Card, CardHeader } from "@/components/ui/Card";
import { Sparkline } from "./Sparkline";
import { fmtClock, fmtMs } from "@/lib/format";
import type { TimeseriesBucket } from "@/lib/types";

export interface LatencyChartProps {
  buckets: TimeseriesBucket[];
  range: string;
  className?: string;
}

export function LatencyChart({ buckets, range, className }: LatencyChartProps) {
  const p95 = buckets.map((b) => b.p95);
  const avg = buckets.map((b) => b.avg);
  const peak = Math.max(0, ...p95);
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <Card className={className}>
      <CardHeader
        title="Latency"
        subtitle={
          <span className="tabular-nums">
            p95 {fmtMs(peak)} · avg {fmtMs(avg.length ? avg.reduce((a, b) => a + b, 0) / avg.length : 0)}
          </span>
        }
        actions={
          <span className="flex items-center gap-2 text-[11px] text-[var(--frost-muted)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-4 rounded bg-indigo-400" /> p95
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-0.5 w-4 rounded bg-emerald-400 opacity-80" /> avg
            </span>
            <span className="glass-badge">{range}</span>
          </span>
        }
      />
      <Sparkline values={p95} secondary={avg} height={110} />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--frost-muted)]">
        <span>{first ? fmtClock(first.t) : "–"}</span>
        <span>{last ? fmtClock(last.t) : "–"}</span>
      </div>
    </Card>
  );
}
