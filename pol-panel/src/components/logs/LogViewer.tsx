import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Api, errorMessage } from "@/lib/api";
import { cn, fmtClock } from "@/lib/format";
import { toastStore } from "@/lib/hooks/useToast";
import { useSSE } from "@/lib/hooks/useSSE";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { LogEntry, LogLevel } from "@/lib/types";

const MAX_ENTRIES = 800;
const WINDOW = 150;

const LEVEL_TONE: Record<LogLevel, BadgeTone> = {
  debug: "neutral",
  info: "blue",
  warn: "orange",
  error: "red",
};

const RANGES: Record<string, number | null> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  all: null,
};

export interface LogFilters {
  level: string;
  source: string;
  q: string;
  regex: boolean;
  range: keyof typeof RANGES;
}

const DEFAULT_FILTERS: LogFilters = { level: "all", source: "all", q: "", regex: false, range: "1h" };

export function LogViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [live, setLive] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [limit, setLimit] = useState(WINDOW);
  const listRef = useRef<HTMLDivElement>(null);

  const append = useCallback((entry: LogEntry) => {
    setEntries((current) => {
      if (current.some((e) => e.id === entry.id)) return current;
      const next = [...current, entry];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  const { connected } = useSSE<LogEntry>(live ? "/api/logs/stream" : null, (_event, data) => {
    if (frozen) return;
    if (data && typeof data.id === "number") append(data);
  });

  const fetchTail = useCallback(async () => {
    try {
      const since = RANGES[filters.range];
      const params = new URLSearchParams({ limit: "500" });
      if (since) params.set("since", String(Date.now() - since));
      if (filters.level !== "all") params.set("level", filters.level);
      if (filters.source !== "all") params.set("source", filters.source);
      if (filters.q) {
        params.set("q", filters.q);
        params.set("regex", String(filters.regex));
      }
      const data = await Api.get<{ entries: LogEntry[] }>(`/api/logs?${params.toString()}`);
      setEntries(data.entries);
    } catch (error) {
      toastStore.error("Cannot load logs", errorMessage(error));
    }
  }, [filters]);

  useEffect(() => {
    void fetchTail();
    // `filters.q` is deliberately absent: typing in the search box filters the
    // buffer client-side, it must not refetch on every keystroke.
  }, [filters.range, filters.level, filters.source, filters.regex]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoScroll]);

  const visible = useMemo(() => {
    const since = RANGES[filters.range];
    const needle = filters.q.trim();
    let matcher: ((text: string) => boolean) | null = null;
    if (needle) {
      if (filters.regex) {
        try {
          const re = new RegExp(needle, "i");
          matcher = (text) => re.test(text);
        } catch {
          matcher = null;
        }
      } else {
        const lower = needle.toLowerCase();
        matcher = (text) => text.toLowerCase().includes(lower);
      }
    }
    return entries
      .filter((entry) => {
        if (since && entry.ts < Date.now() - since) return false;
        if (filters.level !== "all" && entry.level !== filters.level) return false;
        if (filters.source !== "all" && entry.source !== filters.source) return false;
        if (matcher && !matcher(entry.message)) return false;
        return true;
      })
      .slice(-limit);
  }, [entries, filters, limit]);

  const sources = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.source))).sort(),
    [entries],
  );

  const errorCount = useMemo(() => entries.filter((e) => e.level === "error").length, [entries]);

  return (
    <Card>
      <CardHeader
        title="Logs"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{entries.length} buffered</span>
            <span>·</span>
            <span className={errorCount ? "text-red-300" : ""}>{errorCount} errors</span>
            <span>·</span>
            <span className={connected ? "text-emerald-300" : "text-[var(--frost-muted)]"}>
              {connected ? "live" : "reconnecting…"}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFrozen((value) => !value)}
              aria-pressed={frozen}
              title={frozen ? "Resume appending" : "Freeze the view"}
            >
              <Icon name={frozen ? "play" : "pause"} size={14} />
              <span className="hidden sm:inline">{frozen ? "Resume" : "Freeze"}</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAutoScroll((value) => !value)}
              aria-pressed={autoScroll}
              title="Toggle auto-scroll"
            >
              <Icon name="arrowDown" size={14} />
              <span className="hidden sm:inline">Auto</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                window.location.href = "/api/logs/download";
              }}
              title="Download buffer as .log"
            >
              <Icon name="download" size={14} />
              <span className="hidden sm:inline">.log</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void fetchTail()}
              title="Reload buffer"
            >
              <Icon name="refresh" size={14} />
            </Button>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Select
          aria-label="Filter by level"
          value={filters.level}
          onChange={(event) => setFilters((f) => ({ ...f, level: event.target.value }))}
        >
          <option value="all">all levels</option>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
        </Select>
        <Select
          aria-label="Filter by source"
          value={filters.source}
          onChange={(event) => setFilters((f) => ({ ...f, source: event.target.value }))}
        >
          <option value="all">all sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Time range"
          value={filters.range}
          onChange={(event) =>
            setFilters((f) => ({ ...f, range: event.target.value as keyof typeof RANGES }))
          }
        >
          <option value="5m">last 5 min</option>
          <option value="1h">last hour</option>
          <option value="6h">last 6 hours</option>
          <option value="24h">last 24 hours</option>
          <option value="all">everything</option>
        </Select>
        <div className="flex gap-2">
          <Input
            value={filters.q}
            onChange={(event) => setFilters((f) => ({ ...f, q: event.target.value }))}
            placeholder={filters.regex ? "regex…" : "search…"}
            aria-label="Search logs"
            className="flex-1"
          />
          <Button
            size="icon"
            variant={filters.regex ? "primary" : "outline"}
            onClick={() => setFilters((f) => ({ ...f, regex: !f.regex }))}
            aria-pressed={filters.regex}
            aria-label="Toggle regex mode"
            title="Regex mode"
            className="shrink-0 font-mono text-xs"
          >
            .*
          </Button>
        </div>
      </div>

      <div
        ref={listRef}
        className={cn(
          "glass-input h-[52dvh] min-h-[18rem] overflow-y-auto p-2 font-mono text-[11.5px] leading-relaxed",
        )}
      >
        {visible.length === 0 ? (
          <p className="p-2 text-[var(--frost-muted)]">No log lines match these filters.</p>
        ) : null}
        {visible.map((entry) => {
          const isRelay = entry.message.includes("[pol-relay]");
          const isError = entry.level === "error" || /upstream error|traceback/i.test(entry.message);
          return (
            <div
              key={entry.id}
              className={cn(
                "log-line flex gap-2 rounded px-1.5 py-0.5",
                isError && "bg-red-500/10 text-red-200",
                entry.level === "warn" && !isError && "bg-amber-500/10 text-amber-200",
              )}
            >
              <span className="shrink-0 tabular-nums text-[var(--frost-muted)]">
                {fmtClock(entry.ts)}
              </span>
              <Badge tone={LEVEL_TONE[entry.level]} className="shrink-0 !py-0 !px-1.5 text-[10px]">
                {entry.source}
              </Badge>
              <span className={cn("min-w-0 flex-1", isRelay && "text-emerald-200/90")}>
                {entry.message}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--frost-muted)]">
        <span className="tabular-nums">
          showing {visible.length} of {entries.length}
        </span>
        <div className="flex items-center gap-2">
          {entries.length > visible.length ? (
            <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + WINDOW)}>
              Older
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await Api.post("/api/logs/clear");
                setEntries([]);
                toastStore.success("Log buffer cleared");
              } catch (error) {
                toastStore.error("Clear failed", errorMessage(error));
              }
            }}
          >
            Clear
          </Button>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={live}
              onChange={(event) => setLive(event.target.checked)}
              className="h-4 w-4 accent-indigo-400"
            />
            live
          </label>
        </div>
      </div>
    </Card>
  );
}
