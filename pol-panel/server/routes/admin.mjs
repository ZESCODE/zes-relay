/**
 * routes/admin.mjs — tokens, backups, export/import, runtime info.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { ok, fail } from "../envelope.mjs";
import { PATHS, readJson, writeJsonAtomic, sha256File, fileSize } from "../fs-paths.mjs";
import { zipDirectory } from "../zip.mjs";
import { ENV_KEYS } from "../config-store.mjs";

const execFileAsync = promisify(execFile);
const pkg = readJson(path.join(PATHS.panelDir, "package.json"), { version: "0.0.0" });

function safeName(name) {
  const clean = String(name || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (!clean || clean === "." || clean === ".." || clean.includes("..")) return null;
  return clean;
}

export default function adminRoutes({ config, relay, tokens, logBus, metrics, log }) {
  const router = Router();

  router.get("/info", async (req, res) => {
    let python = "unknown";
    try {
      const { stdout, stderr } = await execFileAsync(relay.python, ["-V"], { timeout: 5000 });
      python = (stdout || stderr).trim();
    } catch (err) {
      python = `unavailable (${err?.message || err})`;
    }
    return ok(res, {
      panelVersion: pkg.version,
      nodeVersion: process.version,
      pythonVersion: python,
      relayScript: PATHS.relayScript,
      relaySha256: sha256File(PATHS.relayScript),
      dataDir: PATHS.dataDir,
      logFile: PATHS.panelLog,
      logBytes: fileSize(PATHS.panelLog),
      relay: relay.status(),
      metrics: metrics.summary(),
      tokens: tokens.count(),
      uptimeS: Math.floor(process.uptime()),
    });
  });

  // ── API tokens ─────────────────────────────────────────────────────────────
  router.get("/tokens", (req, res) => ok(res, { tokens: tokens.list() }));

  router.post("/tokens", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return fail(res, 400, "bad_request", "token name is required");
    const created = tokens.create(name, { ip: req.ip });
    log.push({ level: "warn", source: "audit", message: `[audit] token created: ${name} (${created.prefix}…)` });
    return ok(res, created);
  });

  router.delete("/tokens/:id", (req, res) => {
    const result = tokens.revoke(req.params.id);
    if (!result.ok) return fail(res, 404, result.code, result.message);
    log.push({ level: "warn", source: "audit", message: `[audit] token revoked: ${req.params.id}` });
    return ok(res, { revoked: req.params.id });
  });

  // ── export / import ────────────────────────────────────────────────────────
  router.get("/export", (req, res) => {
    const includeSecrets = req.query.secrets === "true";
    const { values } = config.read();
    const exported = {};
    for (const spec of ENV_KEYS) {
      if (spec.secret && !includeSecrets) {
        exported[spec.key] = "";
        continue;
      }
      exported[spec.key] = values[spec.key] ?? "";
    }
    if (includeSecrets) {
      log.push({ level: "warn", source: "audit", message: `[audit] ${req.auth?.username ?? "token"} exported settings WITH secrets` });
    }
    return ok(res, {
      exportedAt: new Date().toISOString(),
      panelVersion: pkg.version,
      secretsIncluded: includeSecrets,
      config: exported,
      relay: relay.status(),
      tokenCount: tokens.count(),
    });
  });

  router.post("/import", (req, res) => {
    const settings = req.body?.settings ?? req.body ?? {};
    const incoming = settings.config ?? settings;
    if (!incoming || typeof incoming !== "object") {
      return fail(res, 400, "bad_request", "settings.config must be an object");
    }
    const filtered = {};
    for (const spec of ENV_KEYS) {
      if (incoming[spec.key] === undefined) continue;
      // Never import an empty secret over a real one.
      if (spec.secret && String(incoming[spec.key]).trim() === "") continue;
      filtered[spec.key] = incoming[spec.key];
    }
    const merged = { ...config.fileValues(), ...filtered };
    const result = config.write(merged);
    if (!result.ok) return fail(res, 400, "invalid_config", "imported settings failed validation", { errors: result.errors });
    log.push({ level: "warn", source: "audit", message: `[audit] settings imported (${Object.keys(filtered).join(", ")})` });
    return ok(res, { imported: Object.keys(filtered), values: config.readMasked().values });
  });

  // ── destructive maintenance ────────────────────────────────────────────────
  router.post("/clear", (req, res) => {
    const clearMetrics = req.body?.metrics !== false;
    const clearLogs = req.body?.logs !== false;
    const result = { metricsCleared: false, logsRemoved: 0 };
    if (clearMetrics) {
      metrics.clear();
      result.metricsCleared = true;
    }
    if (clearLogs) result.logsRemoved = logBus.clear().removed;
    log.push({ level: "warn", source: "audit", message: `[audit] cleared metrics=${clearMetrics} logs=${clearLogs}` });
    return ok(res, result);
  });

  // ── backups ────────────────────────────────────────────────────────────────
  router.post("/backup", (req, res) => {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outFile = path.join(PATHS.backupsDir, `pol-panel-backup-${stamp}.zip`);
      const result = zipDirectory(PATHS.dataDir, outFile, { skip: ["backups"] });
      log.push({ level: "info", source: "audit", message: `[audit] backup created: ${path.basename(outFile)} (${result.bytes} bytes)` });
      return ok(res, { name: path.basename(outFile), ...result });
    } catch (err) {
      return fail(res, 500, "backup_failed", String(err?.message || err));
    }
  });

  router.get("/backups", (req, res) => {
    const entries = fs
      .readdirSync(PATHS.backupsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".zip"))
      .map((e) => {
        const full = path.join(PATHS.backupsDir, e.name);
        const stat = fs.statSync(full);
        return { name: e.name, bytes: stat.size, createdAt: stat.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return ok(res, { backups: entries });
  });

  router.get("/backups/:name", (req, res) => {
    const name = safeName(req.params.name);
    if (!name || !name.endsWith(".zip")) return fail(res, 400, "bad_request", "invalid backup name");
    const full = path.join(PATHS.backupsDir, name);
    if (!fs.existsSync(full)) return fail(res, 404, "not_found", "backup not found");
    res.download(full, name);
  });

  router.delete("/backups/:name", (req, res) => {
    const name = safeName(req.params.name);
    if (!name || !name.endsWith(".zip")) return fail(res, 400, "bad_request", "invalid backup name");
    const full = path.join(PATHS.backupsDir, name);
    if (!fs.existsSync(full)) return fail(res, 404, "not_found", "backup not found");
    fs.unlinkSync(full);
    log.push({ level: "warn", source: "audit", message: `[audit] backup deleted: ${name}` });
    return ok(res, { deleted: name });
  });

  return router;
}
