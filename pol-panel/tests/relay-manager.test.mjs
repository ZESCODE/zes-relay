/**
 * tests/relay-manager.test.mjs — spawn / adopt / stop / auto-restart.
 *
 * A Node script stands in for pol_relay.py so these tests do not depend on the
 * upstream network. The lifecycle code path is identical: spawn a child, wait
 * for GET /health, pipe its output, SIGTERM then SIGKILL on stop.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pol-panel-relay-"));
process.env.POL_DATA_DIR = TMP;

const { RelayManager } = await import("../server/relay-manager.mjs");
const { LogBus } = await import("../server/log-bus.mjs");

const FAKE_RELAY = path.join(TMP, "fake-relay.mjs");
fs.writeFileSync(
  FAKE_RELAY,
  `import http from "node:http";
const port = Number(process.env.POL_RELAY_PORT);
const started = Date.now();
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, data: { status: "ok", uptime_s: Math.floor((Date.now() - started) / 1000), upstream: "mock", disabled_models: 0, cached_models: 0 } }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: { code: "not_found", message: "nope" } }));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => { server.close(); process.exit(0); });
`,
);

const DYING_RELAY = path.join(TMP, "dying-relay.mjs");
fs.writeFileSync(
  DYING_RELAY,
  `import http from "node:http";
const port = Number(process.env.POL_RELAY_PORT);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, data: { status: "ok", uptime_s: 0, upstream: "mock", disabled_models: 0, cached_models: 0 } }));
});
server.listen(port, "127.0.0.1");
setTimeout(() => process.exit(3), 400);
process.on("SIGTERM", () => { server.close(); process.exit(0); });
`,
);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeManager(port, script) {
  const log = new LogBus({ file: path.join(TMP, `log-${port}.jsonl`), max: 200 });
  return new RelayManager({
    port,
    script,
    cwd: TMP,
    python: process.execPath,
    envFor: () => ({ POL_RELAY_PORT: String(port) }),
    log,
  });
}

const managers = [];

function tracked(port, script = FAKE_RELAY) {
  const manager = makeManager(port, script);
  managers.push(manager);
  return manager;
}

afterAll(async () => {
  for (const manager of managers) {
    manager.stopHealthLoop();
    await manager.shutdown();
  }
  await sleep(200);
});

describe("RelayManager", () => {
  let port;
  // One manager owns `port` across the first three tests: a second manager on
  // the same port would (correctly) adopt the first one's relay instead of
  // spawning its own, which is exactly what the adoption test covers later.
  let owner;

  beforeAll(async () => {
    port = await freePort();
  });

  it("spawns the relay, waits for health, and owns the child", async () => {
    const manager = tracked(port);
    owner = manager;
    const result = await manager.start();

    expect(result.started).toBe(true);
    expect(manager.status()).toMatchObject({ state: "running", running: true, owned: true });
    expect(manager.pid).toBeTypeOf("number");

    const health = await manager.probe();
    expect(health.ok).toBe(true);
    expect(health.data.status).toBe("ok");
  });

  it("start is idempotent on a running relay", async () => {
    const first = await owner.start();
    expect(first.alreadyRunning).toBe(true);

    const second = await owner.start();
    expect(second.alreadyRunning).toBe(true);
    expect(owner.state).toBe("running");
  });

  it("stops the child with SIGTERM", async () => {
    const manager = owner;
    const stopped = await manager.stop();
    expect(stopped.stopped).toBe(true);
    expect(manager.status()).toMatchObject({ state: "stopped", running: false, owned: false, pid: null });

    const health = await manager.probe(800);
    expect(health.ok).toBe(false);
  });

  it("adopts an external relay and refuses to kill it", async () => {
    const externalPort = await freePort();
    const external = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { status: "ok", uptime_s: 9, upstream: "external", disabled_models: 0, cached_models: 0 } }));
    });
    await new Promise((resolve) => external.listen(externalPort, "127.0.0.1", resolve));

    const manager = tracked(externalPort);
    try {
      const result = await manager.start();
      expect(result.adopted).toBe(true);
      expect(manager.status()).toMatchObject({ state: "running", owned: false, pid: null });

      const refused = await manager.stop();
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe("external_process");
      expect(manager.state).toBe("running");

      // The override forgets the relay; it cannot signal a pid it never had.
      const forced = await manager.forceKillExternal();
      expect(forced.stopped).toBe(true);
      expect(manager.state).toBe("stopped");
    } finally {
      await new Promise((resolve) => external.close(resolve));
    }
  });

  it("records lifecycle events in data/events.jsonl", async () => {
    const eventsFile = path.join(TMP, "events.jsonl");
    expect(fs.existsSync(eventsFile)).toBe(true);
    const events = fs
      .readFileSync(eventsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const types = events.map((event) => event.type);
    expect(types).toContain("spawned");
    expect(types).toContain("transition");
  });

  it("auto-restarts a relay that dies unexpectedly", async () => {
    const dyingPort = await freePort();
    const manager = tracked(dyingPort, DYING_RELAY);
    await manager.start();
    expect(manager.state).toBe("running");

    // The child exits after 400 ms; the manager waits 1 s then restarts it.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (manager.restartCount >= 1 && manager.state === "running" && manager.lastHealth?.ok) break;
      await sleep(200);
    }

    expect(manager.restartCount).toBeGreaterThanOrEqual(1);
    expect(manager.state).toBe("running");
    expect(manager.lastHealth.ok).toBe(true);
  });
});
