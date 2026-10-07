/**
 * server/index.mjs — the sidecar. The ONLY process that talks to pol_relay.py,
 * the filesystem, or spawns subprocesses. In production it also serves dist/.
 */
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { EventEmitter } from "node:events";

import { PATHS, ensureDataDirs, readJson } from "./fs-paths.mjs";
import { LogBus, getLogBus } from "./log-bus.mjs";
import { getMetrics } from "./metrics.mjs";
import { getRelayManager } from "./relay-manager.mjs";
import { getConfigStore } from "./config-store.mjs";
import { getTokenStore } from "./token-store.mjs";
import { createAttachAuth, createRequireAuth, requireCsrf, ensureAdmin } from "./auth.mjs";
import { ok, fail, clientIp } from "./envelope.mjs";
import { relayFetch } from "./relay-client.mjs";
import { startSweeper } from "./rate-limit.mjs";

import authRoutes from "./routes/auth.mjs";
import relayRoutes from "./routes/relay.mjs";
import modelRoutes from "./routes/models.mjs";
import chatRoutes from "./routes/chat.mjs";
import metricsRoutes from "./routes/metrics.mjs";
import logRoutes from "./routes/logs.mjs";
import configRoutes from "./routes/config.mjs";
import adminRoutes from "./routes/admin.mjs";
import presetRoutes from "./routes/presets.mjs";

export function createPanel({ quiet = false } = {}) {
  ensureDataDirs();
  const logBus = getLogBus();
  const metrics = getMetrics();
  const config = getConfigStore();
  const tokens = getTokenStore();
  const modelsBus = new EventEmitter();
  modelsBus.setMaxListeners(200);

  const relayPort = Number(config.read().values.POL_RELAY_PORT || process.env.POL_RELAY_PORT || 7179);
  const relay = getRelayManager({
    port: relayPort,
    script: PATHS.relayScript,
    cwd: PATHS.relayCwd,
    python: process.env.PYTHON_BIN || "python3",
    envFor: () => config.relayEnv(),
    log: logBus,
    emit: (evt) => modelsBus.emit(evt.type, evt.data),
  });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  const isProd = process.env.NODE_ENV !== "development";
  const secureFor = (req) =>
    Boolean(req?.secure) || String(req?.get?.("x-forwarded-proto") || "").split(",")[0] === "https";

  // ── cookies (no cookie-parser dependency) ─────────────────────────────────
  app.use((req, _res, next) => {
    req.cookies = {};
    const header = req.headers.cookie;
    if (header) {
      for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const key = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(value);
        } catch {
          req.cookies[key] = value;
        }
      }
    }
    next();
  });

  // ── security headers ──────────────────────────────────────────────────────
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // Tailwind emits a stylesheet; React needs inline style attributes.
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        secureFor(req) ? "upgrade-insecure-requests" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    next();
  });

  app.use(express.json({ limit: "4mb" }));

  // ── access log ────────────────────────────────────────────────────────────
  const accessLogEnabled = process.env.PANEL_ACCESS_LOG !== "false";
  app.use((req, res, next) => {
    if (!accessLogEnabled || req.path.startsWith("/api/logs") || req.path === "/theme.js") {
      return next();
    }
    const t0 = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - t0;
      const skip = ms < 250 && req.method === "GET" && res.statusCode < 400;
      if (skip) return;
      logBus.push({
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        source: "access",
        message: `${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms ${clientIp(req)}`,
      });
    });
    next();
  });

  // ── auth ──────────────────────────────────────────────────────────────────
  ensureAdmin(logBus);
  const attachAuth = createAttachAuth({ tokens });
  const requireAuth = createRequireAuth({ tokens });

  // Populates req.auth (or leaves it empty) so /api/auth/me can answer before
  // the enforcing middleware below runs.
  app.use("/api", attachAuth);

  app.get("/api/health", (req, res) =>
    ok(res, {
      panel: "ok",
      version: readJson(path.join(PATHS.panelDir, "package.json"), { version: "0.0.0" }).version,
      node: process.version,
      relay: relay.status().state,
      uptimeS: Math.floor(process.uptime()),
    }),
  );

  app.use("/api/auth", authRoutes({ log: logBus, secureFor }));

  // Everything below requires a session cookie or a valid API token,
  // and state-changing verbs additionally require the CSRF double-submit.
  app.use("/api", requireAuth);
  app.use("/api", requireCsrf);

  app.use("/api/relay", relayRoutes({ relay, log: logBus }));
  app.use("/api/models", modelRoutes({ config, log: logBus, metrics, modelsBus }));
  app.use("/api", chatRoutes({ config, log: logBus, metrics }));
  app.use("/api/metrics", metricsRoutes({ metrics }));
  app.use("/api/logs", logRoutes({ logBus }));
  app.use("/api/config", configRoutes({ config, relay, log: logBus }));
  app.use("/api/admin", adminRoutes({ config, relay, tokens, logBus, metrics, log: logBus }));
  app.use("/api/presets", presetRoutes({ log: logBus }));

  // ── raw relay admin passthrough (for curl/automation from the same host) ──
  app.all(/^\/admin\/.*/, async (req, res) => {
    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const init = { method: req.method };
    if (!["GET", "HEAD"].includes(req.method)) init.body = JSON.stringify(req.body ?? {});
    try {
      const upstream = await relayFetch(`${req.path}${query}`, init, { config, timeoutMs: 10 * 60 * 1000 });
      const text = await upstream.text();
      res.status(upstream.status).type(upstream.headers.get("content-type") || "application/json").send(text);
    } catch (err) {
      fail(res, 502, "relay_unreachable", String(err?.message || err));
    }
  });

  app.use("/api", (req, res) => fail(res, 404, "not_found", `no API route for ${req.method} ${req.originalUrl}`));

  // ── static assets + SPA fallback (production) ─────────────────────────────
  if (fs.existsSync(PATHS.distDir)) {
    app.use(
      express.static(PATHS.distDir, {
        index: false,
        maxAge: isProd ? "1h" : 0,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      }),
    );
    app.get(/^\/(?!api\/|admin\/).*/, (req, res, next) => {
      if (req.method !== "GET") return next();
      const indexHtml = path.join(PATHS.distDir, "index.html");
      if (!fs.existsSync(indexHtml)) return fail(res, 503, "not_built", "run `npm run build` first");
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  } else {
    app.get("/", (req, res) =>
      fail(res, 503, "not_built", "dist/ not found — run `npm run build`, or use `npm run dev`"),
    );
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    logBus.push({ level: "error", source: "panel", message: `[error] ${err?.message || err}` });
    if (err?.type === "entity.too.large") return fail(res, 413, "payload_too_large", "request body too large");
    if (err?.type === "entity.parse.failed") return fail(res, 400, "bad_json", "request body is not valid JSON");
    return fail(res, 500, "internal", err?.message || "internal error");
  });

  return { app, relay, logBus, metrics, config, tokens, modelsBus };
}

export async function startPanel({ port, host } = {}) {
  const { app, relay, logBus } = createPanel();
  const listenPort = Number(port ?? process.env.PANEL_PORT ?? 7178);
  const allowPublic = process.env.PANEL_ALLOW_PUBLIC === "true";
  const requestedHost = host ?? process.env.PANEL_HOST ?? "127.0.0.1";
  const bindHost = requestedHost === "0.0.0.0" || requestedHost === "::" ? requestedHost : requestedHost;

  if ((bindHost === "0.0.0.0" || bindHost === "::") && !allowPublic) {
    process.stderr.write(
      `[pol-panel] refusing to bind ${bindHost}: set PANEL_ALLOW_PUBLIC=true to expose the panel publicly.\n`,
    );
    process.exit(1);
  }

  startSweeper();
  relay.startHealthLoop();
  if (process.env.PANEL_AUTOSTART !== "false") {
    relay.start().catch((err) => logBus.push({ level: "error", source: "panel", message: `[relay] start failed: ${err?.message || err}` }));
  }

  const server = app.listen(listenPort, bindHost, () => {
    const shown = bindHost === "0.0.0.0" ? "127.0.0.1 (and LAN)" : bindHost;
    process.stderr.write(
      `[pol-panel] listening on http://${shown}:${listenPort} -> relay 127.0.0.1:${relay.port}\n`,
    );
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(
        `[pol-panel] port ${listenPort} is already in use. Set PANEL_PORT to another port.\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[pol-panel] ${signal} received — shutting down\n`);
    server.close();
    await relay.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return { server, relay, logBus };
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  startPanel().catch((err) => {
    process.stderr.write(`[pol-panel] fatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}

export { LogBus };
