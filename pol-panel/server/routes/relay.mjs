/**
 * routes/relay.mjs — lifecycle control for the pol_relay.py child process.
 * Start is idempotent: starting a running relay returns { alreadyRunning: true }.
 */
import fs from "node:fs";
import { Router } from "express";
import { ok, fail, sseInit, sseSend, sseHeartbeat, clampInt } from "../envelope.mjs";
import { PATHS } from "../fs-paths.mjs";

function tailJsonl(file, limit) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch {
    return [];
  }
}

export default function relayRoutes({ relay, log }) {
  const router = Router();

  router.get("/status", async (req, res) => {
    if (req.query.probe === "1") await relay.probe(2000);
    return ok(res, relay.status());
  });

  router.post("/start", async (req, res) => {
    const result = await relay.start({ force: Boolean(req.body?.force) });
    if (result.ok === false) {
      return fail(res, 502, "relay_start_failed", result.error, { status: relay.status() });
    }
    return ok(res, result);
  });

  router.post("/stop", async (req, res) => {
    const killExternal = Boolean(req.body?.killExternal);
    const result = await relay.stop({ killExternal, force: Boolean(req.body?.force) });
    if (result.ok === false) {
      return fail(res, 409, result.code || "relay_stop_failed", result.error, { status: relay.status() });
    }
    return ok(res, result);
  });

  router.post("/restart", async (req, res) => {
    const result = await relay.restart();
    if (result?.ok === false) {
      return fail(res, 502, "relay_restart_failed", result.error, { status: relay.status() });
    }
    return ok(res, result);
  });

  /** Double-confirmed kill of a relay the panel did not spawn. */
  router.post("/kill-external", async (req, res) => {
    const { confirmPort, confirmText } = req.body || {};
    if (Number(confirmPort) !== relay.port || confirmText !== "KILL") {
      return fail(
        res,
        400,
        "confirmation_required",
        `Send confirmPort=${relay.port} and confirmText=KILL to force-kill an external relay`,
      );
    }
    const result = await relay.forceKillExternal();
    log.push({ level: "warn", source: "panel", message: "external relay force-killed by operator" });
    return ok(res, result);
  });

  router.get("/events", (req, res) => {
    const limit = clampInt(req.query.limit, 50, 1, 500);
    return ok(res, { events: tailJsonl(PATHS.eventsFile, limit) });
  });

  router.get("/stream", (req, res) => {
    sseInit(res);
    sseSend(res, "status", relay.status());
    const stopHb = sseHeartbeat(res);
    const unsubscribe = relay.onChange((status) => sseSend(res, "status", status));
    req.on("close", () => {
      stopHb();
      unsubscribe();
    });
  });

  return router;
}
