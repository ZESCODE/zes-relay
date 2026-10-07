/**
 * routes/logs.mjs — merged relay + sidecar log stream.
 */
import { Router } from "express";
import { ok, sseInit, sseSend, sseHeartbeat, clampInt } from "../envelope.mjs";

export default function logRoutes({ logBus }) {
  const router = Router();

  router.get("/", (req, res) => {
    const since = req.query.since ? Number(req.query.since) : undefined;
    const until = req.query.until ? Number(req.query.until) : undefined;
    const entries = logBus.query({
      level: req.query.level || undefined,
      source: req.query.source || undefined,
      q: req.query.q || undefined,
      regex: req.query.regex === "true",
      since: Number.isFinite(since) ? since : undefined,
      until: Number.isFinite(until) ? until : undefined,
      limit: clampInt(req.query.limit, 300, 1, 2000),
    });
    return ok(res, { entries, stats: logBus.stats() });
  });

  router.get("/download", (req, res) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res
      .status(200)
      .set({
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="pol-panel-${stamp}.log"`,
      })
      .send(logBus.render());
  });

  router.post("/clear", (req, res) => ok(res, logBus.clear()));

  router.get("/stream", (req, res) => {
    sseInit(res);
    const stopHb = sseHeartbeat(res);
    // Replay the recent tail so a freshly opened viewer is not empty.
    for (const entry of logBus.query({ limit: 100 })) sseSend(res, "log", entry);
    const unsubscribe = logBus.subscribe((entry) => sseSend(res, "log", entry));
    req.on("close", () => {
      stopHb();
      unsubscribe();
    });
  });

  return router;
}
