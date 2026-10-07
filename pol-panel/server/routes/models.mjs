/**
 * routes/models.mjs — per-model activation toggles + test flows.
 *
 * Contract reminder: every relay admin mutation returns HTTP 200 on success,
 * including a toggle that lands on "disabled". The resulting state is read from
 * data.enabled — never inferred from the status code.
 */
import { Router } from "express";
import { ok, fail, sseInit, sseSend, sseHeartbeat } from "../envelope.mjs";
import { relayFetch, readEnvelope } from "../relay-client.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function modelRoutes({ config, log, metrics, modelsBus }) {
  const router = Router();

  const proxyError = (res, env) =>
    fail(res, env.status === 0 ? 502 : env.status || 502, env.code, env.message);

  /** Pure fetch helper — never touches the response object. */
  async function fetchModels({ refresh = false, all = false } = {}) {
    let path = all ? "/v1/models?all=true" : "/admin/models";
    if (refresh) path += path.includes("?") ? "&refresh=1" : "?refresh=1";
    const upstream = await relayFetch(path, {}, { config, timeoutMs: 25000 });
    const text = await upstream.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    if (upstream.status !== 200 || !body) {
      return {
        ok: false,
        env: {
          status: upstream.status,
          code: body?.error?.code || "bad_upstream",
          message: body?.error?.message || text.slice(0, 200) || `relay HTTP ${upstream.status}`,
        },
      };
    }
    // /admin/models -> {ok,data:[…]} | /v1/models -> {object,data:[…]}
    const models = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
    return { ok: true, models };
  }

  router.get("/", async (req, res) => {
    try {
      const result = await fetchModels({ refresh: req.query.refresh === "1" });
      if (!result.ok) return proxyError(res, result.env);
      return ok(res, { models: result.models, at: Date.now() });
    } catch (err) {
      return fail(res, 502, "relay_unreachable", String(err?.message || err));
    }
  });

  /** Enabled-only list for the playground dropdown (the relay already filters). */
  router.get("/available", async (req, res) => {
    try {
      const includeDisabled = req.query.all === "true";
      const path = includeDisabled ? "/v1/models?all=true" : "/v1/models";
      const upstream = await relayFetch(path, {}, { config, timeoutMs: 25000 });
      const text = await upstream.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return fail(res, 502, "bad_upstream", `relay returned non-JSON: ${text.slice(0, 120)}`);
      }
      const models = Array.isArray(body?.data) ? body.data : [];
      return ok(res, { models, includeDisabled, at: Date.now() });
    } catch (err) {
      return fail(res, 502, "relay_unreachable", String(err?.message || err));
    }
  });

  router.get("/disabled", async (req, res) => {
    const env = await readEnvelope(await relayFetch("/admin/models/disabled", {}, { config, timeoutMs: 10000 }));
    if (!env.ok) return proxyError(res, env);
    return ok(res, env.data);
  });

  /** enable | disable | toggle — all return { id, enabled } from the relay. */
  for (const action of ["enable", "disable", "toggle"]) {
    router.post(`/${action}`, async (req, res) => {
      const id = String(req.body?.id ?? "").trim();
      if (!id) return fail(res, 400, "bad_request", "missing 'id'");
      const env = await readEnvelope(
        await relayFetch(
          `/admin/models/${action}`,
          { method: "POST", body: JSON.stringify({ id }) },
          { config, timeoutMs: 10000 },
        ),
      );
      if (!env.ok) return proxyError(res, env);
      const data = env.data || {};
      if (typeof data.enabled !== "boolean") {
        return fail(res, 502, "bad_envelope", "relay response missing data.enabled");
      }
      log.push({
        level: "info",
        source: "panel",
        message: `[models] ${action} ${id} -> enabled=${data.enabled}`,
      });
      metrics.record({
        path: `/admin/models/${action}`,
        status: env.status,
        ms: 0,
        model: id,
      });
      modelsBus.emit("change", { reason: action, id, enabled: data.enabled });
      return ok(res, data);
    });
  }

  router.post("/reset", async (req, res) => {
    const env = await readEnvelope(
      await relayFetch("/admin/models/reset", { method: "POST", body: "{}" }, { config, timeoutMs: 10000 }),
    );
    if (!env.ok) return proxyError(res, env);
    log.push({ level: "warn", source: "panel", message: "[models] disabled set reset to default (all enabled)" });
    modelsBus.emit("change", { reason: "reset" });
    return ok(res, env.data ?? { disabled: [] });
  });

  router.post("/test", async (req, res) => {
    const id = String(req.body?.id ?? "").trim();
    if (!id) return fail(res, 400, "bad_request", "missing 'id'");
    const t0 = Date.now();
    const env = await readEnvelope(
      await relayFetch(
        "/admin/models/test",
        { method: "POST", body: JSON.stringify({ id }) },
        { config, timeoutMs: 45000 },
      ),
    );
    if (!env.ok) return proxyError(res, env);
    const result = { id, ...(env.data || {}) };
    metrics.record({
      path: "/admin/models/test",
      status: result.ok ? 200 : result.status || 502,
      ms: Date.now() - t0,
      model: id,
      error: result.ok ? undefined : result.error || `test failed (${result.status})`,
    });
    modelsBus.emit("test", { id, result });
    return ok(res, result);
  });

  /**
   * Non-streaming test-all. The relay computes the whole map in one response.
   * For a row-by-row UI use GET /api/models/test-all/stream.
   */
  router.post("/test-all", async (req, res) => {
    const env = await readEnvelope(
      await relayFetch(
        "/admin/models/test-all",
        { method: "POST", body: "{}" },
        { config, timeoutMs: 10 * 60 * 1000 },
      ),
    );
    if (!env.ok) return proxyError(res, env);
    const results = env.data?.results || {};
    const ids = Object.keys(results);
    for (const id of ids) {
      const r = results[id] || {};
      metrics.record({
        path: "/admin/models/test",
        status: r.ok ? 200 : r.status || 502,
        ms: r.latency_ms || 0,
        model: id,
        error: r.ok ? undefined : r.error || `test failed (${r.status})`,
      });
    }
    modelsBus.emit("test-all", { results });
    return ok(res, env.data);
  });

  /**
   * SSE test-all.
   *   mode=sequential (default) — one POST /admin/models/test per model, so the
   *                               UI genuinely updates row by row and Cancel
   *                               stops before the remaining models run.
   *   mode=batch                — single POST /admin/models/test-all, then the
   *                               finished map is re-emitted row by row.
   */
  router.get("/test-all/stream", async (req, res) => {
    const mode = req.query.mode === "batch" ? "batch" : "sequential";
    sseInit(res);
    sseSend(res, "start", { mode, at: Date.now() });
    const stopHb = sseHeartbeat(res);
    const ctrl = new AbortController();
    let cancelled = false;
    req.on("close", () => {
      cancelled = true;
      ctrl.abort();
      stopHb();
    });

    try {
      const listed = await fetchModels({});
      if (!listed.ok) {
        sseSend(res, "error", { code: listed.env.code, message: listed.env.message });
        return;
      }
      const ids = listed.models.map((m) => m.id).filter(Boolean);
      sseSend(res, "plan", { total: ids.length, ids });

      if (mode === "batch") {
        const env = await readEnvelope(
          await relayFetch(
            "/admin/models/test-all",
            { method: "POST", body: "{}" },
            { config, timeoutMs: 10 * 60 * 1000, signal: ctrl.signal },
          ),
        );
        if (!env.ok) {
          sseSend(res, "error", { code: env.code, message: env.message });
          return;
        }
        const results = env.data?.results || {};
        let passed = 0;
        let failed = 0;
        let n = 0;
        for (const id of ids) {
          if (cancelled) break;
          const r = results[id];
          if (!r) continue;
          n += 1;
          if (r.ok) passed += 1;
          else failed += 1;
          metrics.record({
            path: "/admin/models/test",
            status: r.ok ? 200 : r.status || 502,
            ms: r.latency_ms || 0,
            model: id,
            error: r.ok ? undefined : r.error || `test failed (${r.status})`,
          });
          sseSend(res, "result", { id, ...r });
          await sleep(30); // let the UI paint each row
        }
        modelsBus.emit("test-all", { results });
        sseSend(res, "done", { tested: n, total: ids.length, passed, failed, cancelled });
        return;
      }

      let passed = 0;
      let failed = 0;
      let tested = 0;
      for (const id of ids) {
        if (cancelled) break;
        const t0 = Date.now();
        const env = await readEnvelope(
          await relayFetch(
            "/admin/models/test",
            { method: "POST", body: JSON.stringify({ id }) },
            { config, timeoutMs: 45000, signal: ctrl.signal },
          ),
        ).catch((err) => ({
          ok: false,
          status: 0,
          code: "relay_unreachable",
          message: String(err?.message || err),
        }));
        if (cancelled) break;
        tested += 1;
        if (!env.ok) {
          failed += 1;
          const result = { ok: false, status: env.status || 0, error: env.message, latency_ms: Date.now() - t0, ts: Date.now() };
          metrics.record({ path: "/admin/models/test", status: 0, ms: Date.now() - t0, model: id, error: env.message });
          sseSend(res, "result", { id, ...result });
          continue;
        }
        const r = env.data || {};
        if (r.ok) passed += 1;
        else failed += 1;
        metrics.record({
          path: "/admin/models/test",
          status: r.ok ? 200 : r.status || 502,
          ms: r.latency_ms || Date.now() - t0,
          model: id,
          error: r.ok ? undefined : r.error || `test failed (${r.status})`,
        });
        sseSend(res, "result", { id, ...r });
        modelsBus.emit("test", { id, result: { id, ...r } });
      }
      sseSend(res, "done", { tested, total: ids.length, passed, failed, cancelled });
    } catch (err) {
      if (!cancelled) sseSend(res, "error", { code: "test_all_failed", message: String(err?.message || err) });
    } finally {
      stopHb();
    }
  });

  /** Invalidation stream: fired after every mutation so all tabs stay in sync. */
  router.get("/stream", (req, res) => {
    sseInit(res);
    const stopHb = sseHeartbeat(res);
    const onChange = (payload) => sseSend(res, "change", payload);
    const onTest = (payload) => sseSend(res, "test", payload);
    modelsBus.on("change", onChange);
    modelsBus.on("test", onTest);
    req.on("close", () => {
      stopHb();
      modelsBus.off("change", onChange);
      modelsBus.off("test", onTest);
    });
  });

  return router;
}
