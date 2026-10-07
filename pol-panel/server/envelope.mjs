/**
 * envelope.mjs — the panel speaks the exact same envelope as the relay:
 *   success: { ok: true,  data }
 *   failure: { ok: false, error: { code, message } }
 * plus a couple of SSE helpers shared by every streaming route.
 */

export function ok(res, data = null, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function fail(res, status, code, message, extra) {
  return res.status(status).json({
    ok: false,
    error: { code, message: String(message ?? code), ...(extra || {}) },
  });
}

export function clientIp(req) {
  const fwd = req.get("x-forwarded-for");
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stop proxies (and the Vite dev proxy) from buffering the stream.
    "X-Accel-Buffering": "no",
  });
  res.write(":connected\n\n");
  res.flushHeaders?.();
}

export function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/** Keep-alive comment so proxies do not consider the stream idle. */
export function sseHeartbeat(res, everyMs = 15000) {
  const timer = setInterval(() => {
    try {
      res.write(`:hb ${Date.now()}\n\n`);
    } catch {
      clearInterval(timer);
    }
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function clampInt(value, def, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
