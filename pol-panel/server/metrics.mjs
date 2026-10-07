/**
 * metrics.mjs — in-memory ring buffers + counters for relay traffic.
 *
 * Node is single-threaded, so every mutation here is a single writer by
 * construction: no locks are required and none are simulated.
 */

const MAX_SAMPLES = 3600;
const MAX_ERRORS = 200;

const RANGES = {
  "1h": { spanMs: 60 * 60 * 1000, bucketMs: 60 * 1000 },
  "6h": { spanMs: 6 * 60 * 60 * 1000, bucketMs: 5 * 60 * 1000 },
  "24h": { spanMs: 24 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
};

export function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  );
  return sortedValues[idx];
}

export class Metrics {
  constructor({ maxSamples = MAX_SAMPLES } = {}) {
    this.maxSamples = maxSamples;
    this.startedAt = Date.now();
    this.samples = [];
    // Named `errorSamples` (not `errors`) so the `errors(limit)` query method
    // below is not shadowed by an own property.
    this.errorSamples = [];
    this.counters = {
      requests: 0,
      errors: 0,
      bytes: 0,
      tokensIn: 0,
      tokensOut: 0,
      streamsOpened: 0,
    };
    this.activeStreams = 0;
    this.byStatus = {};
    this.byModel = new Map();
    this.byEndpoint = new Map();
    this.lastError = null;
  }

  /**
   * @param {object} evt
   * @param {number} evt.ts        epoch ms
   * @param {string} evt.path      endpoint that was called
   * @param {number} evt.status    HTTP status returned to the caller
   * @param {number} evt.ms        wall-clock latency in ms
   * @param {string} [evt.model]   model id from the request body
   * @param {number} [evt.bytes]   bytes relayed back to the caller
   * @param {number} [evt.tokensIn]
   * @param {number} [evt.tokensOut]
   * @param {string} [evt.error]   error message, if any
   */
  record(evt) {
    const sample = {
      t: evt.ts ?? Date.now(),
      path: evt.path || "unknown",
      status: Number(evt.status) || 0,
      ms: Math.max(0, Math.round(Number(evt.ms) || 0)),
      model: evt.model || null,
      bytes: Math.max(0, Number(evt.bytes) || 0),
      tokensIn: Math.max(0, Number(evt.tokensIn) || 0),
      tokensOut: Math.max(0, Number(evt.tokensOut) || 0),
      error: evt.error ? String(evt.error).slice(0, 500) : null,
    };
    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }

    this.counters.requests += 1;
    this.counters.bytes += sample.bytes;
    this.counters.tokensIn += sample.tokensIn;
    this.counters.tokensOut += sample.tokensOut;
    this.byStatus[sample.status] = (this.byStatus[sample.status] || 0) + 1;

    const bucketFor = (map, key) => {
      if (!key) return null;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { requests: 0, errors: 0, ms: [], bytes: 0, tokensIn: 0, tokensOut: 0, lastStatus: 0, lastTs: 0 };
        map.set(key, bucket);
      }
      return bucket;
    };

    const isErr = sample.status >= 400 || sample.status === 0;
    if (isErr) {
      this.counters.errors += 1;
      this.errorSamples.push({
        t: sample.t,
        path: sample.path,
        status: sample.status,
        model: sample.model,
        message: sample.error || `HTTP ${sample.status}`,
      });
      if (this.errorSamples.length > MAX_ERRORS) {
        this.errorSamples.splice(0, this.errorSamples.length - MAX_ERRORS);
      }
      this.lastError = {
        ts: sample.t,
        status: sample.status,
        message: (sample.error || `HTTP ${sample.status}`).slice(0, 500),
      };
    }

    for (const [map, key] of [
      [this.byModel, sample.model],
      [this.byEndpoint, sample.path],
    ]) {
      const bucket = bucketFor(map, key);
      if (!bucket) continue;
      bucket.requests += 1;
      if (isErr) bucket.errors += 1;
      bucket.bytes += sample.bytes;
      bucket.tokensIn += sample.tokensIn;
      bucket.tokensOut += sample.tokensOut;
      bucket.lastStatus = sample.status;
      bucket.lastTs = sample.t;
      if (bucket.ms.length < 600) bucket.ms.push(sample.ms);
    }
    return sample;
  }

  streamOpened() {
    this.activeStreams += 1;
    this.counters.streamsOpened += 1;
  }

  streamClosed() {
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  latencyOf(samples) {
    if (!samples.length) return { p50: 0, p95: 0, p99: 0, avg: 0 };
    const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      avg: Math.round(avg),
    };
  }

  summary() {
    const now = Date.now();
    const windowStart = now - 60 * 1000;
    const recent = this.samples.filter((s) => s.t >= windowStart);
    return {
      startedAt: this.startedAt,
      uptimeS: Math.floor((now - this.startedAt) / 1000),
      requests: this.counters.requests,
      errors: this.counters.errors,
      requestsPerMin: recent.length,
      errorsPerMin: recent.filter((s) => s.status >= 400 || s.status === 0).length,
      errorRate: this.counters.requests
        ? Number(((this.counters.errors / this.counters.requests) * 100).toFixed(2))
        : 0,
      activeStreams: this.activeStreams,
      bytes: this.counters.bytes,
      tokensIn: this.counters.tokensIn,
      tokensOut: this.counters.tokensOut,
      latency: this.latencyOf(this.samples.slice(-600)),
      byStatus: { ...this.byStatus },
      lastError: this.lastError,
      sampleCount: this.samples.length,
    };
  }

  timeseries(range = "1h") {
    const cfg = RANGES[range] || RANGES["1h"];
    const now = Date.now();
    const start = now - cfg.spanMs;
    const bucketCount = Math.ceil(cfg.spanMs / cfg.bucketMs);
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      t: start + i * cfg.bucketMs,
      requests: 0,
      errors: 0,
      ms: [],
      tokens: 0,
      bytes: 0,
    }));
    for (const s of this.samples) {
      if (s.t < start) continue;
      const idx = Math.min(bucketCount - 1, Math.floor((s.t - start) / cfg.bucketMs));
      const b = buckets[idx];
      b.requests += 1;
      if (s.status >= 400 || s.status === 0) b.errors += 1;
      b.ms.push(s.ms);
      b.tokens += s.tokensIn + s.tokensOut;
      b.bytes += s.bytes;
    }
    return buckets.map((b) => {
      const sorted = b.ms.sort((a, c) => a - c);
      return {
        t: b.t,
        requests: b.requests,
        errors: b.errors,
        tokens: b.tokens,
        bytes: b.bytes,
        p95: percentile(sorted, 95),
        avg: sorted.length ? Math.round(sorted.reduce((a, c) => a + c, 0) / sorted.length) : 0,
      };
    });
  }

  models() {
    const out = [];
    for (const [model, b] of this.byModel) {
      out.push({
        model,
        requests: b.requests,
        errors: b.errors,
        bytes: b.bytes,
        tokensIn: b.tokensIn,
        tokensOut: b.tokensOut,
        lastStatus: b.lastStatus,
        lastTs: b.lastTs,
        p95: percentile([...b.ms].sort((a, c) => a - c), 95),
        avg: b.ms.length ? Math.round(b.ms.reduce((a, c) => a + c, 0) / b.ms.length) : 0,
      });
    }
    return out.sort((a, b) => b.requests - a.requests);
  }

  endpoints() {
    const out = [];
    for (const [path, b] of this.byEndpoint) {
      out.push({
        path,
        requests: b.requests,
        errors: b.errors,
        p95: percentile([...b.ms].sort((a, c) => a - c), 95),
        avg: b.ms.length ? Math.round(b.ms.reduce((a, c) => a + c, 0) / b.ms.length) : 0,
        lastTs: b.lastTs,
      });
    }
    return out.sort((a, b) => b.requests - a.requests);
  }

  errors(limit = 50) {
    return this.errorSamples.slice(-limit).reverse();
  }

  clear() {
    this.samples = [];
    this.errorSamples = [];
    this.byStatus = {};
    this.byModel.clear();
    this.byEndpoint.clear();
    this.counters = {
      requests: 0,
      errors: 0,
      bytes: 0,
      tokensIn: 0,
      tokensOut: 0,
      streamsOpened: 0,
    };
    this.activeStreams = 0;
    this.lastError = null;
  }
}

export function getMetrics(opts) {
  if (!globalThis.__polPanelMetrics) globalThis.__polPanelMetrics = new Metrics(opts);
  return globalThis.__polPanelMetrics;
}
