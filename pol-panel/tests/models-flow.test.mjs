/**
 * tests/models-flow.test.mjs
 *
 * End-to-end proof of the contract that the whole panel is built on:
 *   spawn the real pol_relay.py  →  toggle a model off  →  chat returns
 *   403 model_disabled  →  toggle it back on  →  chat returns 200.
 *
 * Every relay mutation answers HTTP 200 (even the one that disables a model),
 * so the assertions below read `data.enabled` rather than the status code.
 *
 * The upstream is a local mock so the test is hermetic.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pol-panel-flow-"));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const relayPort = await freePort();
const mockPort = await freePort();

// ── mock upstream ───────────────────────────────────────────────────────────
const MODELS = [
  { id: "openai", object: "model", owned_by: "openai", created: 1 },
  { id: "mistral", object: "model", owned_by: "mistral", created: 1 },
];

let chatCalls = 0;
const mockUpstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: MODELS }));
      return;
    }
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      chatCalls += 1;
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        /* ignore */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "pong" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "not_found", message: "mock 404" } }));
  });
});

// ── environment must be set before the server modules read it ───────────────
process.env.POL_DATA_DIR = TMP;
process.env.POL_RELAY_PORT = String(relayPort);
process.env.POL_UPSTREAM_BASE = `http://127.0.0.1:${mockPort}/v1`;
process.env.POL_SKIP_AUTH = "true";
process.env.POL_MODEL_CACHE_TTL = "1";
process.env.PANEL_ADMIN_USER = "admin";
process.env.PANEL_ADMIN_PASSWORD = "integration-pass-123";
process.env.PANEL_AUTOSTART = "false";
process.env.PANEL_ACCESS_LOG = "false";
process.env.NODE_ENV = "test";

const { createPanel } = await import("../server/index.mjs");

let panel;
let server;
let base;
let cookies = "";
let csrf = "";

async function call(pathname, { method = "GET", body, withCsrf = true, cookie = cookies } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(withCsrf && csrf ? { "x-csrf-token": csrf } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

beforeAll(async () => {
  await new Promise((resolve) => mockUpstream.listen(mockPort, "127.0.0.1", resolve));

  panel = createPanel({ quiet: true });
  server = panel.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const started = await panel.relay.start();
  if (!started.started && !started.alreadyRunning && !started.adopted) {
    throw new Error(`relay failed to start: ${JSON.stringify(started)}`);
  }

  const loginResponse = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "integration-pass-123" }),
  });
  expect(loginResponse.status).toBe(200);
  const loginBody = await loginResponse.json();
  expect(loginBody.ok).toBe(true);
  // The fetch API exposes Set-Cookie through getSetCookie().
  cookies = (loginResponse.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  csrf = loginBody.data.csrf;
  expect(cookies).toContain("pp_sid");
  expect(cookies).toContain("pp_csrf");
});

afterAll(async () => {
  panel?.relay.stopHealthLoop();
  await panel?.relay.shutdown();
  await new Promise((resolve) => server?.close(resolve));
  await new Promise((resolve) => mockUpstream.close(resolve));
});

describe("models flow (real relay + mock upstream)", () => {
  it("spawns the relay and reports it healthy through the panel", async () => {
    const status = await call("/api/relay/status");
    expect(status.status).toBe(200);
    expect(status.json.ok).toBe(true);
    expect(status.json.data.state).toBe("running");
    expect(status.json.data.owned).toBe(true);
    expect(status.json.data.lastHealth.ok).toBe(true);
  });

  it("lists models from the relay with enabled flags", async () => {
    const models = await call("/api/models?refresh=1");
    expect(models.status).toBe(200);
    const ids = models.json.data.models.map((m) => m.id).sort();
    expect(ids).toEqual(["mistral", "openai"]);
    expect(models.json.data.models.every((m) => m.enabled === true)).toBe(true);
  });

  it("toggle answers HTTP 200 even though it DISABLES the model", async () => {
    const toggle = await call("/api/models/toggle", { method: "POST", body: { id: "mistral" } });
    expect(toggle.status).toBe(200);
    expect(toggle.json.ok).toBe(true);
    expect(toggle.json.data).toEqual({ id: "mistral", enabled: false });
  });

  it("rejects chat for a disabled model with 403 model_disabled", async () => {
    const chat = await call("/api/chat", {
      method: "POST",
      body: { model: "mistral", messages: [{ role: "user", content: "ping" }], stream: false },
    });
    expect(chat.status).toBe(403);
    expect(chat.json.ok).toBe(false);
    expect(chat.json.error.code).toBe("model_disabled");
  });

  it("the relay itself returns the same 403 (panel is a client, not a shim)", async () => {
    const direct = await fetch(`http://127.0.0.1:${relayPort}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ model: "mistral", messages: [{ role: "user", content: "ping" }] }),
    });
    expect(direct.status).toBe(403);
    const body = await direct.json();
    expect(body.error.code).toBe("model_disabled");
  });

  it("hides disabled models from /v1/models but shows them with ?all=true", async () => {
    const enabled = await call("/api/models/available");
    expect(enabled.json.data.models.map((m) => m.id)).toEqual(["openai"]);

    const all = await call("/api/models/available?all=true");
    const mistral = all.json.data.models.find((m) => m.id === "mistral");
    expect(mistral.enabled).toBe(false);
  });

  it("re-enabling returns 200 with enabled:true and chat works again", async () => {
    const enable = await call("/api/models/enable", { method: "POST", body: { id: "mistral" } });
    expect(enable.status).toBe(200);
    expect(enable.json.data.enabled).toBe(true);

    const chat = await call("/api/chat", {
      method: "POST",
      body: { model: "mistral", messages: [{ role: "user", content: "ping" }], stream: false },
    });
    expect(chat.status).toBe(200);
    expect(chat.json.choices[0].message.content).toBe("pong");
    expect(chat.json.usage.total_tokens).toBe(4);
    expect(chatCalls).toBeGreaterThan(0);
  });

  it("reset clears the disabled set", async () => {
    await call("/api/models/disable", { method: "POST", body: { id: "openai" } });
    const disabled = await call("/api/models/disabled");
    expect(disabled.json.data.disabled).toContain("openai");

    const reset = await call("/api/models/reset", { method: "POST" });
    expect(reset.status).toBe(200);
    const after = await call("/api/models/disabled");
    expect(after.json.data.disabled).toEqual([]);
  });

  it("per-model test records a result", async () => {
    const test = await call("/api/models/test", { method: "POST", body: { id: "openai" } });
    expect(test.status).toBe(200);
    expect(test.json.data.ok).toBe(true);
    expect(test.json.data.status).toBe(200);
    expect(test.json.data.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("streams test-all results row by row", async () => {
    const response = await fetch(`${base}/api/models/test-all/stream?mode=sequential`, {
      headers: { cookie: cookies, accept: "text/event-stream" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    // Read until the sidecar says the run is done.
    while (!events.some((entry) => entry.event === "done")) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
        const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
        if (eventLine && dataLine) {
          events.push({ event: eventLine.slice(6).trim(), data: JSON.parse(dataLine.slice(5).trim()) });
        }
      }
    }
    await reader.cancel();

    const names = events.map((entry) => entry.event);
    expect(names).toContain("start");
    expect(names).toContain("plan");
    expect(names.filter((name) => name === "result").length).toBeGreaterThanOrEqual(2);
    const done = events.find((entry) => entry.event === "done");
    expect(done.data.tested).toBeGreaterThanOrEqual(2);
  });

  it("enforces auth and CSRF on state-changing routes", async () => {
    const anonymous = await fetch(`${base}/api/models`, { method: "GET" });
    expect(anonymous.status).toBe(401);

    const noCsrf = await call("/api/models/toggle", {
      method: "POST",
      body: { id: "openai" },
      withCsrf: false,
    });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.json.error.code).toBe("csrf");
  });

  it("persists the disabled set to data/models.json", async () => {
    await call("/api/models/disable", { method: "POST", body: { id: "mistral" } });
    const file = path.join(TMP, "models.json");
    expect(fs.existsSync(file)).toBe(true);
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stored.disabled).toContain("mistral");
    await call("/api/models/reset", { method: "POST" });
  });
});
