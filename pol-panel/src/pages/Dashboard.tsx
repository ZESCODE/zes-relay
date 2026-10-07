import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Api, errorMessage } from "@/lib/api";
import { fmtBytes, fmtDuration, fmtMs, fmtNumber, fmtAgo, cn } from "@/lib/format";
import { useInterval } from "@/lib/hooks/useInterval";
import { useSSE } from "@/lib/hooks/useSSE";
import { toastStore } from "@/lib/hooks/useToast";
import { useRelay } from "@/lib/hooks/useRelay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { HealthBadge } from "@/components/dashboard/HealthBadge";
import { StatTile } from "@/components/dashboard/StatTile";
import { Icon } from "@/components/ui/Icon";
import { LatencyChart } from "@/components/charts/LatencyChart";
import { RequestsChart } from "@/components/charts/RequestsChart";
import { Shell } from "@/components/layout/Shell";
import type { MetricsSummary, ModelMetricsRow, RelayEvent, TimeseriesBucket } from "@/lib/types";

interface ErrorRow {
  t: number;
  path: string;
  status: number;
  model: string | null;
  message: string;
}

const RANGES = ["1h", "6h", "24h"] as const;
type Range = (typeof RANGES)[number];

export function Dashboard() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [buckets, setBuckets] = useState<TimeseriesBucket[]>([]);
  const [modelRows, setModelRows] = useState<ModelMetricsRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [events, setEvents] = useState<RelayEvent[]>([]);
  const [range, setRange] = useState<Range>("1h");
  const { status, busy, start, stop, restart } = useRelay();

  const loadTimeseries = useCallback(async () => {
    try {
      const data = await Api.get<{ buckets: TimeseriesBucket[] }>(`/api/metrics/timeseries?range=${range}`);
      setBuckets(data.buckets);
    } catch {
      /* the tiles keep working even if the chart is stale */
    }
  }, [range]);

  const loadSideData = useCallback(async () => {
    try {
      const [models, errorData, eventData] = await Promise.all([
        Api.get<{ models: ModelMetricsRow[] }>("/api/metrics/models"),
        Api.get<{ errors: ErrorRow[] }>("/api/metrics/errors?limit=8"),
        Api.get<{ events: RelayEvent[] }>("/api/relay/events?limit=6"),
      ]);
      setModelRows(models.models);
      setErrors(errorData.errors);
      setEvents(eventData.events);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadTimeseries();
  }, [loadTimeseries]);

  useEffect(() => {
    void loadSideData();
  }, [loadSideData]);

  const { error: streamError } = useSSE<MetricsSummary>("/api/metrics/stream", (_event, data) => {
    if (data && typeof data.requests === "number") setSummary(data);
  });

  // Charts refresh slower than the tiles: 20 s is plenty and kinder to a phone.
  useInterval(() => void loadTimeseries(), 20_000);
  useInterval(() => void loadSideData(), 10_000);

  const trendFor = summary
    ? {
        direction: (summary.requestsPerMin > 0 ? "up" : "flat") as "up" | "flat",
        label: `${summary.requestsPerMin}/min now`,
      }
    : undefined;

  return (
    <Shell
      title="Dashboard"
      subtitle="Live relay metrics"
      actions={
        <Button
          size="icon"
          variant="ghost"
          onClick={async () => {
            try {
              await Api.post("/api/metrics/clear");
              setSummary(null);
              await loadTimeseries();
              toastStore.success("Metrics cleared");
            } catch (error) {
              toastStore.error("Clear failed", errorMessage(error));
            }
          }}
          aria-label="Clear metrics"
          title="Clear metrics"
        >
          <Icon name="trash" size={16} />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Card className="flex flex-wrap items-center gap-2">
          <HealthBadge status={status} showDetails />
          <span className="text-xs text-[var(--frost-muted)] truncate">
            {status?.running
              ? `up ${fmtDuration(status.startedAt ? (Date.now() - status.startedAt) / 1000 : 0)} · pid ${status.pid ?? "external"}`
              : "relay is not running"}
          </span>
          <span className="flex-1" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="success" loading={busy} onClick={() => void start()} disabled={status?.running}>
              Start
            </Button>
            <Button size="sm" loading={busy} onClick={() => void restart()} disabled={!status?.running}>
              Restart
            </Button>
            <Button size="sm" variant="danger" loading={busy} onClick={() => void stop()} disabled={!status?.running}>
              Stop
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <StatTile
            label="Requests"
            value={fmtNumber(summary?.requests ?? 0)}
            sub="since panel start"
            icon="bolt"
            tone="blue"
            trend={trendFor}
          />
          <StatTile
            label="Errors"
            value={fmtNumber(summary?.errors ?? 0)}
            sub={`${summary?.errorRate ?? 0}% of traffic`}
            icon="warning"
            tone={(summary?.errors ?? 0) > 0 ? "red" : "neutral"}
          />
          <StatTile
            label="p95 latency"
            value={fmtMs(summary?.latency.p95 ?? 0)}
            sub={`p50 ${fmtMs(summary?.latency.p50 ?? 0)} · p99 ${fmtMs(summary?.latency.p99 ?? 0)}`}
            icon="clock"
            tone={(summary?.latency.p95 ?? 0) > 5000 ? "orange" : "green"}
          />
          <StatTile
            label="Tokens"
            value={fmtNumber((summary?.tokensIn ?? 0) + (summary?.tokensOut ?? 0))}
            sub={`${fmtNumber(summary?.tokensIn ?? 0)} in · ${fmtNumber(summary?.tokensOut ?? 0)} out`}
            icon="terminal"
            tone="violet"
          />
          <StatTile
            label="Active streams"
            value={fmtNumber(summary?.activeStreams ?? 0)}
            sub={`${fmtNumber(summary?.sampleCount ?? 0)} samples buffered`}
            icon="play"
          />
          <StatTile
            label="Relayed"
            value={fmtBytes(summary?.bytes ?? 0)}
            sub="response bytes"
            icon="download"
          />
          <StatTile
            label="Panel uptime"
            value={fmtDuration(summary?.uptimeS ?? 0)}
            sub="since sidecar start"
            icon="shield"
          />
          <StatTile
            label="Last error"
            value={summary?.lastError ? `${summary.lastError.status || "ERR"}` : "none"}
            sub={summary?.lastError ? `${fmtAgo(summary.lastError.ts)} · ${summary.lastError.message.slice(0, 40)}` : "clean run so far"}
            icon="cross"
            tone={summary?.lastError ? "orange" : "neutral"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <RequestsChart
            buckets={buckets}
            range={range}
            className="lg:order-1"
          />
          <LatencyChart buckets={buckets} range={range} className="lg:order-2" />
        </div>

        <div className="flex justify-center lg:justify-start -mt-1">
          <div className="inline-flex rounded-full border border-[var(--frost-border-strong)] p-0.5 text-xs">
            {RANGES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                aria-pressed={range === value}
                className={cn(
                  "h-8 rounded-full px-3 transition-colors",
                  range === value
                    ? "bg-indigo-500/30 text-indigo-50"
                    : "text-[var(--frost-muted)] hover:text-[var(--frost-text)]",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader
              title="Per-model traffic"
              subtitle="Requests seen by the panel sidecar"
              actions={
                <Link to="/models" className="text-xs text-indigo-300 hover:underline">
                  Manage models
                </Link>
              }
            />
            {modelRows.length === 0 ? (
              <p className="text-sm text-[var(--frost-muted)]">
                No model traffic yet. Try a request in the Playground.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--frost-border)]">
                {modelRows.slice(0, 8).map((row) => (
                  <li key={row.model} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="font-mono flex-1 truncate" title={row.model}>
                      {row.model}
                    </span>
                    <span className="tabular-nums">{row.requests} req</span>
                    <span className={cn("tabular-nums", row.errors > 0 && "text-red-300")}>
                      {row.errors} err
                    </span>
                    <span className="tabular-nums text-[var(--frost-muted)] w-16 text-right">
                      {fmtMs(row.p95)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent errors" subtitle="Newest first" />
            {errors.length === 0 ? (
              <p className="text-sm text-[var(--frost-muted)]">No errors recorded.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {errors.map((row, index) => (
                  <li key={`${row.t}-${index}`} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Badge tone={row.status >= 500 ? "red" : "orange"}>{row.status || "ERR"}</Badge>
                      <span className="font-mono truncate">{row.model ?? row.path}</span>
                      <span className="ml-auto text-[var(--frost-muted)] tabular-nums">
                        {fmtAgo(row.t)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[var(--frost-muted)] break-words line-clamp-2">
                      {row.message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Lifecycle events" subtitle="data/events.jsonl" />
          {events.length === 0 ? (
            <p className="text-sm text-[var(--frost-muted)]">No lifecycle events yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--frost-border)]">
              {events.map((event, index) => (
                <li key={index} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="tabular-nums text-[var(--frost-muted)]">{fmtAgo(event.ts)}</span>
                  <Badge tone="blue">{event.type}</Badge>
                  <span className="truncate text-[var(--frost-muted)]">
                    {Object.entries(event)
                      .filter(([key]) => !["ts", "type"].includes(key))
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {streamError ? (
          <p className="text-xs text-red-300">Metrics stream error: {streamError}</p>
        ) : null}
      </div>
    </Shell>
  );
}
