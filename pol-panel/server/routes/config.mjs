/**
 * routes/config.mjs — data/.env editor with validation, masking and diffing.
 * Secrets are masked everywhere except the audited reveal endpoint.
 */
import { Router } from "express";
import { ok, fail } from "../envelope.mjs";
import { ENV_KEYS } from "../config-store.mjs";

export default function configRoutes({ config, relay, log }) {
  const router = Router();

  router.get("/", (req, res) => {
    const masked = config.readMasked();
    const diff = config.diff(relay.currentEnv || {});
    return ok(res, {
      specs: ENV_KEYS,
      values: masked.values,
      source: masked.source,
      diff,
      relayState: relay.status().state,
      file: config.file,
    });
  });

  router.post("/", (req, res) => {
    const incoming = req.body?.values ?? req.body ?? {};
    // A masked secret coming back unchanged must not overwrite the real value.
    const current = config.read().values;
    for (const spec of ENV_KEYS) {
      if (!spec.secret) continue;
      if (incoming[spec.key] === undefined || String(incoming[spec.key]).includes("•")) {
        incoming[spec.key] = current[spec.key];
      }
    }
    const result = config.write(incoming);
    if (!result.ok) return fail(res, 400, "invalid_config", "configuration failed validation", { errors: result.errors });
    log.push({ level: "warn", source: "config", message: `[config] data/.env updated (${Object.keys(incoming).length} keys)` });
    return ok(res, { saved: true, values: config.readMasked().values, diff: config.diff(relay.currentEnv || {}) });
  });

  /** Audited plaintext reveal of one secret. */
  router.post("/reveal", (req, res) => {
    const key = String(req.body?.key ?? "");
    const result = config.reveal(key);
    if (!result.ok) return fail(res, 400, result.code, result.message);
    log.push({
      level: "warn",
      source: "audit",
      message: `[audit] ${req.auth?.username ?? req.auth?.name ?? "token"} revealed ${key}`,
    });
    return ok(res, { key, value: result.value });
  });

  router.post("/save-restart", async (req, res) => {
    const incoming = req.body?.values ?? {};
    if (Object.keys(incoming).length > 0) {
      const current = config.read().values;
      for (const spec of ENV_KEYS) {
        if (!spec.secret) continue;
        if (incoming[spec.key] === undefined || String(incoming[spec.key]).includes("•")) {
          incoming[spec.key] = current[spec.key];
        }
      }
      const saved = config.write(incoming);
      if (!saved.ok) return fail(res, 400, "invalid_config", "configuration failed validation", { errors: saved.errors });
    }
    const restarted = await relay.restart();
    log.push({ level: "warn", source: "config", message: "[config] save & restart issued" });
    return ok(res, { saved: true, relay: restarted });
  });

  return router;
}
