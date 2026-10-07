/**
 * tests/metrics.test.mjs — ring buffers, counters, percentiles, timeseries.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Metrics, percentile } from "../server/metrics.mjs";

describe("percentile", () => {
  it("returns 0 for an empty series", () => {
    expect(percentile([], 95)).toBe(0);
  });

  it("picks the nearest-rank value", () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile(sorted, 99)).toBe(100);
  });
});

describe("Metrics", () => {
  let metrics;

  beforeEach(() => {
    metrics = new Metrics({ maxSamples: 100 });
  });

  it("counts requests, errors and bytes", () => {
    metrics.record({ path: "/v1/chat/completions", status: 200, ms: 120, model: "openai", bytes: 512, tokensIn: 10, tokensOut: 20 });
    metrics.record({ path: "/v1/chat/completions", status: 200, ms: 240, model: "openai", bytes: 256, tokensIn: 5, tokensOut: 8 });
    metrics.record({ path: "/v1/chat/completions", status: 500, ms: 40, model: "mistral", error: "boom" });

    const summary = metrics.summary();
    expect(summary.requests).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.bytes).toBe(768);
    expect(summary.tokensIn).toBe(15);
    expect(summary.tokensOut).toBe(28);
    expect(summary.errorRate).toBeCloseTo(33.33, 1);
    expect(summary.byStatus["200"]).toBe(2);
    expect(summary.byStatus["500"]).toBe(1);
    expect(summary.lastError).toMatchObject({ status: 500, message: "boom" });
  });

  it("reports p50/p95/p99 latency", () => {
    for (let ms = 10; ms <= 100; ms += 10) {
      metrics.record({ path: "/x", status: 200, ms });
    }
    const { latency } = metrics.summary();
    expect(latency.p50).toBe(50);
    expect(latency.p95).toBe(100);
    expect(latency.p99).toBe(100);
    expect(latency.avg).toBe(55);
  });

  it("caps the ring buffer at maxSamples", () => {
    for (let i = 0; i < 250; i += 1) {
      metrics.record({ path: "/x", status: 200, ms: i });
    }
    expect(metrics.samples.length).toBe(100);
    // The counter is not capped, only the sample buffer is.
    expect(metrics.summary().requests).toBe(250);
  });

  it("builds per-model and per-endpoint breakdowns", () => {
    metrics.record({ path: "/v1/chat/completions", status: 200, ms: 100, model: "openai" });
    metrics.record({ path: "/v1/chat/completions", status: 429, ms: 10, model: "openai", error: "slow down" });
    metrics.record({ path: "/admin/models/test", status: 200, ms: 30, model: "mistral" });

    const models = metrics.models();
    const openai = models.find((m) => m.model === "openai");
    expect(openai).toMatchObject({ requests: 2, errors: 1, lastStatus: 429 });

    const endpoints = metrics.endpoints();
    expect(endpoints.find((e) => e.path === "/v1/chat/completions").requests).toBe(2);
  });

  it("buckets a timeseries by range", () => {
    const now = Date.now();
    metrics.record({ path: "/x", status: 200, ms: 50, ts: now - 1000 });
    metrics.record({ path: "/x", status: 500, ms: 60, ts: now - 1000, error: "boom" });
    metrics.record({ path: "/x", status: 200, ms: 70, ts: now - 5 * 60 * 1000 });

    const buckets = metrics.timeseries("1h");
    expect(buckets.length).toBe(60);
    expect(buckets.reduce((sum, b) => sum + b.requests, 0)).toBe(3);
    expect(buckets.reduce((sum, b) => sum + b.errors, 0)).toBe(1);

    // Anything older than the window is dropped.
    expect(metrics.timeseries("1h").some((b) => b.requests > 0)).toBe(true);
  });

  it("keeps a bounded error list and clears on demand", () => {
    metrics.record({ path: "/x", status: 500, ms: 5, error: "a" });
    expect(metrics.errors(10)).toHaveLength(1);
    metrics.clear();
    expect(metrics.summary().requests).toBe(0);
    expect(metrics.errors()).toHaveLength(0);
    expect(metrics.models()).toHaveLength(0);
  });

  it("tracks active streams", () => {
    metrics.streamOpened();
    metrics.streamOpened();
    expect(metrics.summary().activeStreams).toBe(2);
    metrics.streamClosed();
    expect(metrics.summary().activeStreams).toBe(1);
    metrics.streamClosed();
    metrics.streamClosed();
    expect(metrics.summary().activeStreams).toBe(0);
  });
});
