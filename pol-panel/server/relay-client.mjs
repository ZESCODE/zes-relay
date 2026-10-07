/**
 * relay-client.mjs — the only place that speaks HTTP to pol_relay.py.
 * The browser never talks to the relay directly; everything funnels through
 * the sidecar so the relay can stay bound to 127.0.0.1.
 */

export function relayAuthHeaders(config) {
  const { values } = config.read();
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (values.POL_SKIP_AUTH !== "true" && values.POL_API_KEY) {
    headers.Authorization = `Bearer ${values.POL_API_KEY}`;
  } else {
    // The relay only checks for the presence of the header when SKIP_AUTH is off.
    headers.Authorization = "Bearer pol-panel";
  }
  return headers;
}

export function relayUrl(config, path) {
  const { values } = config.read();
  const port = Number(values.POL_RELAY_PORT || 7179);
  return `http://127.0.0.1:${port}${path}`;
}

/**
 * @param {string} path
 * @param {object} [init]
 * @param {{config:object, timeoutMs?:number, signal?:AbortSignal}} deps
 */
export async function relayFetch(path, init = {}, deps) {
  const { config, timeoutMs = 30000, signal } = deps;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(relayUrl(config, path), {
      ...init,
      headers: { ...relayAuthHeaders(config), ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a relay envelope, tolerating both {ok,data} and bare JSON. */
export async function readEnvelope(res) {
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.status === 200 && body && body.ok === true) {
    return { ok: true, status: res.status, data: body.data ?? null, raw: body };
  }
  const code = body?.error?.code || (res.status === 200 ? "bad_envelope" : "upstream_error");
  const message =
    body?.error?.message || text.slice(0, 300) || `relay returned HTTP ${res.status}`;
  return { ok: false, status: res.status, code, message, raw: body };
}
