/**
 * routes/metrics.mjs — summary, timeseries, per-model/per-endpoint breakdowns
 * and a 2 s SSE push used by the dashboard tiles.
 */
import { Router } from "express";
import { ok, sseInit, sseSend, sseHeartbeat, clampInt } from "../envelope.mjs";

export default function metricsRoutes({ metrics }) {
  const router = Router();

  router.get("/summary", (req, res) => ok(res, metrics.summary()));

  router.get("/timeseries", (req, res) => {
    const range = ["1h", "6h", "24h"].includes(req.query.range) ? req.query.range : "1h";
    return ok(res, { range, buckets: metrics.timeseries(range) });
  });

  router.get("/models", (req, res) => ok(res, { models: metrics.models() }));

  router.get("/endpoints", (req, res) => ok(res, { endpoints: metrics.endpoints() }));

  router.get("/errors", (req, res) => {
    const limit = clampInt(req.query.limit, 50, 1, 200);
    return ok(res, { errors: metrics.errors(limit) });
  });

  router.post("/clear", (req, res) => {
    metrics.clear();
    return ok(res, { cleared: true });
  });

  router.get("/stream", (req, res) => {
    sseInit(res);
    sseSend(res, "summary", metrics.summary());
    const stopHb = sseHeartbeat(res);
    const interval = setInterval(() => {
      if (!sseSend(res, "summary", metrics.summary())) clearInterval(interval);
    }, 2000);
    interval.unref?.();
    req.on("close", () => {
      clearInterval(interval);
      stopHb();
    });
  });

  return router;
}
