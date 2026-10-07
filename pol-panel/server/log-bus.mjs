/**
 * log-bus.mjs — merged log stream for the relay subprocess + the sidecar.
 *
 * One ring buffer (default 5000 lines) that is:
 *   • mirrored to data/logs/panel.jsonl (size-rotated at 5 MB)
 *   • fanned out to SSE subscribers at /api/logs/stream
 *   • queryable with level/source/substring/regex/time filters
 *
 * Secrets are redacted on the way in, never on the way out.
 */
import { appendLine, rotateIfNeeded, readTextIfExists, PATHS } from "./fs-paths.mjs";

const REDACT_PATTERNS = [
  [/bearer\s+[^\s"',}]+/gi, "Bearer ***"],
  [/\bsk-[A-Za-z0-9_\-]{6,}\b/g, "sk-***"],
  [/("?api[_-]?key"?\s*[:=]\s*"?)[^",}\s]+/gi, "$1***"],
  [/("?password"?\s*[:=]\s*"?)[^",}\s]+/gi, "$1***"],
];

export function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const [re, replacement] of REDACT_PATTERNS) out = out.replace(re, replacement);
  return out;
}

const LEVELS = ["debug", "info", "warn", "error"];

export class LogBus {
  constructor({ file = PATHS.panelLog, max = 5000 } = {}) {
    this.file = file;
    this.max = max;
    this.entries = [];
    this.subs = new Set();
    this.seq = 0;
  }

  /** @param {{level?:string, source?:string, message:string, meta?:object}} entry */
  push(entry) {
    const line = {
      id: ++this.seq,
      ts: Date.now(),
      level: LEVELS.includes(entry.level) ? entry.level : "info",
      source: entry.source || "panel",
      message: redact(String(entry.message ?? "")).slice(0, 4000),
      ...(entry.meta ? { meta: entry.meta } : {}),
    };
    this.entries.push(line);
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
    appendLine(this.file, JSON.stringify(line));
    rotateIfNeeded(this.file);
    for (const cb of this.subs) {
      try {
        cb(line);
      } catch {
        /* a broken subscriber must not break the bus */
      }
    }
    return line;
  }

  info(message, meta) {
    return this.push({ level: "info", source: "panel", message, meta });
  }

  warn(message, meta) {
    return this.push({ level: "warn", source: "panel", message, meta });
  }

  error(message, meta) {
    return this.push({ level: "error", source: "panel", message, meta });
  }

  /** Tagged writer used when piping a subprocess stream. */
  pipe(source, level = "info") {
    return (message, meta) => this.push({ level, source, message, meta });
  }

  subscribe(cb) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  query({
    level,
    source,
    q,
    regex = false,
    since,
    until,
    limit = 500,
  } = {}) {
    let matcher = null;
    if (q) {
      if (regex) {
        try {
          matcher = new RegExp(q, "i");
        } catch {
          matcher = null;
        }
      } else {
        const needle = q.toLowerCase();
        matcher = { test: (s) => s.toLowerCase().includes(needle) };
      }
    }
    const out = [];
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const e = this.entries[i];
      if (level && e.level !== level) continue;
      if (source && e.source !== source) continue;
      if (since && e.ts < since) continue;
      if (until && e.ts > until) continue;
      if (matcher && !matcher.test(e.message)) continue;
      out.push(e);
      if (out.length >= limit) break;
    }
    return out.reverse();
  }

  /** Plain-text rendering used by the "download .log" action. */
  render() {
    const file = readTextIfExists(this.file);
    if (file) {
      return this.entries
        .map((e) => `${new Date(e.ts).toISOString()} [${e.source}/${e.level}] ${e.message}`)
        .join("\n");
    }
    return this.entries
      .map((e) => `${new Date(e.ts).toISOString()} [${e.source}/${e.level}] ${e.message}`)
      .join("\n");
  }

  clear() {
    const removed = this.entries.length;
    this.entries = [];
    return { removed };
  }

  stats() {
    const byLevel = {};
    for (const e of this.entries) byLevel[e.level] = (byLevel[e.level] || 0) + 1;
    return { total: this.entries.length, byLevel, subscribers: this.subs.size };
  }
}

export function getLogBus(opts) {
  if (!globalThis.__polPanelLogBus) globalThis.__polPanelLogBus = new LogBus(opts);
  return globalThis.__polPanelLogBus;
}
