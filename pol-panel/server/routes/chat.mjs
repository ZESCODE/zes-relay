/**
 * routes/chat.mjs — playground chat proxy (streaming + non-streaming).
 *
 * The relay is the client-facing API; this route exists so the browser never
 * needs the relay's port, and so latency/token/error metrics get recorded.
 * A relay 403 model_disabled is forwarded verbatim so the UI can offer the
 * "Enable this model now" recovery action.
 */
import { Router } from "express";
import { fail, clientIp } from "../envelope.mjs";
import { relayFetch, relayUrl } from "../relay-client.mjs";
import { rateLimit } from "../rate-limit.mjs";

/** Pull `usage` out of a non-streaming chat completion body. */
export function extractUsage(body) {
  if (!body || typeof body !== "object") return null;
  if (body.usage && typeof body.usage === "object") {
    return {
      prompt_tokens: Number(body.usage.prompt_tokens) || 0,
      completion_tokens: Number(body.usage.completion_tokens) || 0,
      total_tokens: Number(body.usage.total_tokens) || 0,
    };
  }
  return null;
}

/** Parse an SSE chunk buffer, returning deltas + any usage seen. */
export function scanSseChunk(text, acc) {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.text ?? "";
    if (typeof delta === "string" && delta) acc.text += delta;
    const usage = extractUsage(parsed);
    if (usage) acc.usage = usage;
  }
  return acc;
}

export default function chatRoutes({ config, log, metrics }) {
  const router = Router();
  const rpm = Number(process.env.PANEL_CHAT_RPM || 30);

  const chatLimiter = rateLimit({
    windowMs: 60_000,
    max: rpm,
    name: "chat",
    key: (req) => `${req.auth?.username ?? clientIp(req)}`,
  });

  router.post("/chat", chatLimiter, async (req, res) => {
    const body = req.body ?? {};
    const model = typeof body.model === "string" ? body.model : null;
    if (!model) return fail(res, 400, "bad_request", "missing 'model'");
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return fail(res, 400, "bad_request", "messages must be a non-empty array");
    }
    const streaming = Boolean(body.stream);
    const t0 = Date.now();
    let ttfb = 0;
    let bytes = 0;

    const ctrl = new AbortController();
    const onClose = () => ctrl.abort();
    res.on("close", onClose);

    let upstream;
    try {
      upstream = await relayFetch(
        "/v1/chat/completions",
        { method: "POST", body: JSON.stringify(body) },
        { config, timeoutMs: (Number(config.read().values.POL_UPSTREAM_TIMEOUT) || 600) * 1000 + 5000, signal: ctrl.signal },
      );
    } catch (err) {
      metrics.record({
        path: "/v1/chat/completions",
        status: 0,
        ms: Date.now() - t0,
        model,
        error: `relay unreachable: ${String(err?.message || err)}`,
      });
      log.push({ level: "error", source: "panel", message: `[chat] relay unreachable: ${err?.message || err}` });
      return fail(res, 502, "relay_unreachable", String(err?.message || err));
    }
    ttfb = Date.now() - t0;

    // Non-200 (including 403 model_disabled) is forwarded with the same shape.
    if (upstream.status !== 200) {
      const text = await upstream.text();
      bytes = Buffer.byteLength(text);
      let message = text.slice(0, 300);
      let code = "upstream_error";
      try {
        const parsed = JSON.parse(text);
        code = parsed?.error?.code || code;
        message = parsed?.error?.message || message;
      } catch {
        /* not JSON — keep the raw slice */
      }
      metrics.record({
        path: "/v1/chat/completions",
        status: upstream.status,
        ms: Date.now() - t0,
        model,
        bytes,
        error: message,
      });
      log.push({ level: "warn", source: "panel", message: `[chat] ${model} -> ${upstream.status} ${code}` });
      res.status(upstream.status).type("application/json").send(text);
      return;
    }

    if (!streaming) {
      const text = await upstream.text();
      bytes = Buffer.byteLength(text);
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const usage = extractUsage(parsed);
      metrics.record({
        path: "/v1/chat/completions",
        status: 200,
        ms: Date.now() - t0,
        model,
        bytes,
        tokensIn: usage?.prompt_tokens ?? 0,
        tokensOut: usage?.completion_tokens ?? 0,
      });
      res
        .status(200)
        .set({
          "Content-Type": upstream.headers.get("content-type") || "application/json",
          "X-Pol-Panel-TTFB-ms": String(ttfb),
        })
        .send(text);
      return;
    }

    // ── streaming passthrough ────────────────────────────────────────────────
    metrics.streamOpened();
    const acc = { text: "", usage: null };
    let pending = "";
    res.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Pol-Panel-TTFB-ms": String(ttfb),
    });
    try {
      for await (const chunk of upstream.body) {
        const buf = Buffer.from(chunk);
        bytes += buf.length;
        pending += buf.toString("utf8");
        const lastNewline = pending.lastIndexOf("\n");
        if (lastNewline >= 0) {
          scanSseChunk(pending.slice(0, lastNewline + 1), acc);
          pending = pending.slice(lastNewline + 1);
        }
        res.write(buf);
      }
      if (pending) scanSseChunk(pending, acc);
      res.end();
    } catch (err) {
      log.push({ level: "warn", source: "panel", message: `[chat] stream aborted for ${model}: ${err?.message || err}` });
      res.end();
    } finally {
      metrics.streamClosed();
      const completionTokens =
        acc.usage?.completion_tokens ?? Math.max(0, Math.round(acc.text.length / 4));
      metrics.record({
        path: "/v1/chat/completions",
        status: 200,
        ms: Date.now() - t0,
        model,
        bytes,
        tokensIn: acc.usage?.prompt_tokens ?? 0,
        tokensOut: completionTokens,
      });
      res.removeListener("close", onClose);
    }
  });

  /** Raw relay URL, exposed so the Playground's "raw request" pane is honest. */
  router.get("/upstream", (req, res) => {
    const { values } = config.read();
    return res.json({
      ok: true,
      data: {
        relay: relayUrl(config, "/v1/chat/completions"),
        upstream: `${values.POL_UPSTREAM_BASE}/chat/completions`,
      },
    });
  });

  return router;
}
