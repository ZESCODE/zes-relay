import { Card, CardHeader } from "@/components/ui/Card";
import { fmtClock } from "@/lib/format";
import type { TimeseriesBucket } from "@/lib/types";

export interface RequestsChartProps {
  buckets: TimeseriesBucket[];
  range: string;
  className?: string;
}

/** Stacked request/error bars, hand-rolled SVG (see Sparkline for why). */
export function RequestsChart({ buckets, range, className }: RequestsChartProps) {
  const peak = Math.max(1, ...buckets.map((b) => b.requests));
  const total = buckets.reduce((sum, b) => sum + b.requests, 0);
  const errors = buckets.reduce((sum, b) => sum + b.errors, 0);
  const height = 110;
  const gap = buckets.length > 60 ? 0.15 : 0.25;
  const slot = buckets.length > 0 ? 100 / buckets.length : 100;
  const barWidth = slot * (1 - gap);

  return (
    <Card className={className}>
      <CardHeader
        title="Requests"
        subtitle={
          <span className="tabular-nums">
            {total} total · {errors} error{errors === 1 ? "" : "s"}
          </span>
        }
        actions={
          <span className="flex items-center gap-2 text-[11px] text-[var(--frost-muted)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-indigo-400" /> ok
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-red-400" /> error
            </span>
            <span className="glass-badge">{range}</span>
          </span>
        }
      />

      {buckets.length === 0 || total === 0 ? (
        <div className="grid place-items-center text-xs text-[var(--frost-muted)]" style={{ height }}>
          no traffic recorded yet
        </div>
      ) : (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
          role="img"
          aria-label={`Bar chart of requests per bucket, peak ${peak}`}
        >
          <line x1="0" x2="100" y1="99.5" y2="99.5" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          {buckets.map((bucket, index) => {
            const totalHeight = (bucket.requests / peak) * 96;
            const errorHeight = (bucket.errors / peak) * 96;
            const okHeight = Math.max(0, totalHeight - errorHeight);
            const x = index * slot + (slot - barWidth) / 2;
            return (
              <g key={bucket.t}>
                <rect
                  x={x}
                  y={100 - totalHeight}
                  width={barWidth}
                  height={okHeight}
                  rx={0.4}
                  fill="rgba(129,140,248,0.85)"
                />
                {errorHeight > 0 ? (
                  <rect
                    x={x}
                    y={100 - errorHeight}
                    width={barWidth}
                    height={errorHeight}
                    rx={0.4}
                    fill="rgba(248,113,113,0.9)"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--frost-muted)]">
        <span>{buckets[0] ? fmtClock(buckets[0].t) : "–"}</span>
        <span>peak {peak}/bucket</span>
        <span>{buckets.length ? fmtClock(buckets[buckets.length - 1].t) : "–"}</span>
      </div>
    </Card>
  );
}
