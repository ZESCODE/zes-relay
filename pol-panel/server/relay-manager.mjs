/**
 * relay-manager.mjs — owns the pol_relay.py child process.
 *
 * Lifecycle rules (see BUILD-PROMPT §3.4 and §5):
 *   • Start/stop/restart are idempotent. Starting a running relay returns
 *     { alreadyRunning: true } — never an error.
 *   • A relay already listening on the port is ADOPTED (owned:false) and can
 *     never be killed unless the caller passes killExternal:true.
 *   • Graceful shutdown: SIGTERM → 5 s → SIGKILL.
 *   • Unexpected exits are restarted with exponential backoff: 1 s → 2 s → 4 s.
 *   • Every transition is appended to data/events.jsonl and pushed to log-bus.
 */
import { spawn } from "node:child_process";
import { appendLine, PATHS } from "./fs-paths.mjs";

const HEALTH_EVERY_MS = 5000;
const START_TIMEOUT_MS = 12000;
const STOP_GRACE_MS = 5000;
const BACKOFFS = [1000, 2000, 4000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RelayManager {
  /**
   * @param {object} opts
   * @param {number} opts.port
   * @param {string} opts.script
   * @param {string} opts.cwd
   * @param {string} opts.python
   * @param {() => Record<string,string>} opts.envFor   env for the child process
   * @param {{push:(e:object)=>void}} opts.log
   * @param {(e:{type:string,data:object})=>void} [opts.emit]
   */
  constructor(opts) {
    this.port = opts.port;
    this.script = opts.script;
    this.cwd = opts.cwd;
    this.python = opts.python;
    this.envFor = opts.envFor;
    this.log = opts.log;
    this.emit = opts.emit || (() => {});
    this.child = null;
    this.owned = false;
    this.state = "stopped"; // stopped | starting | running | stopping | crashed
    this.pid = null;
    this.startedAt = null;
    this.stoppedAt = null;
    this.restartCount = 0;
    this.lastTransition = { at: Date.now(), from: "stopped", to: "stopped", reason: "init" };
    this.lastHealth = null;
    this.lastError = null;
    /** Config snapshot the relay was last started with (for the diff view). */
    this.currentEnv = {};
    this.healthTimer = null;
    this.healthMisses = 0;
    this.shutdownRequested = false;
    this.listeners = new Set();
    this.baseUrl = `http://127.0.0.1:${this.port}`;
  }

  onChange(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  #set(state, reason) {
    const from = this.state;
    if (from === state) return;
    this.state = state;
    this.lastTransition = { at: Date.now(), from, to: state, reason };
    this.#event("transition", { from, to: state, reason, pid: this.pid, owned: this.owned });
    this.log.push({
      level: state === "crashed" ? "error" : "info",
      source: "panel",
      message: `[relay] ${from} -> ${state} (${reason})`,
    });
    for (const cb of this.listeners) {
      try {
        cb(this.status());
      } catch {
        /* ignore */
      }
    }
    this.emit({ type: "relay", data: this.status() });
  }

  #event(type, data) {
    appendLine(
      PATHS.eventsFile,
      JSON.stringify({ ts: Date.now(), type, ...data }),
    );
  }

  status() {
    return {
      state: this.state,
      running: this.state === "running",
      owned: this.owned,
      pid: this.pid,
      port: this.port,
      baseUrl: this.baseUrl,
      script: this.script,
      cwd: this.cwd,
      python: this.python,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      restartCount: this.restartCount,
      lastTransition: this.lastTransition,
      lastHealth: this.lastHealth,
      lastError: this.lastError,
      healthMisses: this.healthMisses,
    };
  }

  /** Live liveness probe against GET /health. */
  async probe(timeoutMs = 3000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: ctrl.signal });
      const ms = Date.now() - t0;
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const ok = res.status === 200 && body?.ok === true;
      this.lastHealth = { ok, status: res.status, ms, at: Date.now(), data: body?.data ?? null };
      return this.lastHealth;
    } catch (err) {
      this.lastHealth = {
        ok: false,
        status: 0,
        ms: Date.now() - t0,
        at: Date.now(),
        error: err?.name === "AbortError" ? "timeout" : String(err?.message || err),
      };
      return this.lastHealth;
    } finally {
      clearTimeout(timer);
    }
  }

  async start({ force = false } = {}) {
    if (this.state === "running") {
      return { alreadyRunning: true, ...this.status() };
    }
    if (this.state === "starting" || this.state === "stopping") {
      return { busy: true, ...this.status() };
    }

    // Adopt an externally managed relay rather than fighting over the port.
    const probe = await this.probe(1500);
    if (probe.ok) {
      this.owned = false;
      this.pid = null;
      this.startedAt = Date.now();
      this.#set("running", "adopted external relay");
      this.#event("adopted", { port: this.port });
      return { adopted: true, ...this.status() };
    }

    this.#set("starting", force ? "forced start" : "start");
    try {
      await this.#spawn();
      const ready = await this.#waitForHealth(START_TIMEOUT_MS);
      if (!ready.ok) {
        this.lastError = ready.error || "relay did not become healthy";
        this.#set("crashed", "health check failed after start");
        return { ok: false, error: this.lastError, ...this.status() };
      }
      this.owned = true;
      this.restartCount = 0;
      this.#set("running", "spawned");
      return { started: true, ...this.status() };
    } catch (err) {
      this.lastError = String(err?.message || err);
      this.#set("crashed", this.lastError);
      return { ok: false, error: this.lastError, ...this.status() };
    }
  }

  async stop({ killExternal = false, force = false } = {}) {
    if (this.state === "stopped") {
      return { alreadyStopped: true, ...this.status() };
    }
    if (!this.owned && !killExternal) {
      return {
        ok: false,
        code: "external_process",
        error:
          "This relay was not spawned by the panel. Use 'Force kill external process' to override.",
        ...this.status(),
      };
    }

    this.#set("stopping", force ? "forced stop" : "stop");
    if (this.child) {
      await this.#terminate(this.child);
    }
    this.child = null;
    this.pid = null;
    this.owned = false;
    this.stoppedAt = Date.now();
    this.healthMisses = 0;
    this.#set("stopped", killExternal && !this.owned ? "external killed" : "stopped");
    this.#event("stopped", { forced: force, external: killExternal });
    return { stopped: true, ...this.status() };
  }

  async restart() {
    await this.stop({ killExternal: false, force: true });
    // If the process was external we still need to re-probe/adopt below.
    const result = await this.start({ force: true });
    this.#event("restarted", { state: this.state });
    return result;
  }

  /** Kill a relay the panel did not spawn. Requires an explicit override. */
  async forceKillExternal() {
    return this.stop({ killExternal: true, force: true });
  }

  #spawn() {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...this.envFor() };
      let child;
      try {
        child = spawn(this.python, [this.script], {
          cwd: this.cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        reject(err);
        return;
      }
      this.child = child;
      this.pid = child.pid ?? null;
      this.startedAt = Date.now();
      this.currentEnv = { ...this.envFor() };
      this.#event("spawned", { pid: this.pid, script: this.script, port: this.port });
      this.log.push({
        level: "info",
        source: "panel",
        message: `[relay] spawned pid=${this.pid} ${this.python} ${this.script} (port ${this.port})`,
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let pendingOut = "";
      let pendingErr = "";
      child.stdout.on("data", (chunk) => {
        pendingOut += chunk;
        const lines = pendingOut.split("\n");
        pendingOut = lines.pop() || "";
        for (const line of lines) if (line.trim()) this.log.push({ level: "info", source: "relay", message: line });
      });
      child.stderr.on("data", (chunk) => {
        pendingErr += chunk;
        const lines = pendingErr.split("\n");
        pendingErr = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const level = /error|traceback|failed/i.test(line) ? "error" : "info";
          this.log.push({ level, source: "relay", message: line });
        }
      });

      child.on("error", (err) => {
        this.lastError = String(err?.message || err);
        this.log.push({ level: "error", source: "panel", message: `[relay] spawn error: ${this.lastError}` });
        reject(err);
      });

      child.on("exit", (code, signal) => {
        const wasChild = this.child === child;
        if (wasChild) {
          this.child = null;
          this.pid = null;
        }
        this.#event("exit", { code, signal, pid: child.pid });
        this.log.push({
          level: code === 0 ? "info" : "warn",
          source: "panel",
          message: `[relay] process exited code=${code} signal=${signal ?? "-"}`,
        });
        if (this.shutdownRequested || this.state === "stopping" || this.state === "stopped") return;
        if (!wasChild) return;
        void this.#scheduleRestart(code, signal);
      });

      // Resolve as soon as the process is alive; health is confirmed by the caller.
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) resolve(child);
        else reject(new Error(`relay exited immediately (code=${child.exitCode})`));
      }, 350);
      child.once("error", () => clearTimeout(timer));
      timer.unref?.();
      resolve(child);
    });
  }

  async #waitForHealth(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await this.probe(1200);
      if (last.ok) return last;
      if (this.child && this.child.exitCode !== null) {
        return { ok: false, error: `relay exited with code ${this.child.exitCode}` };
      }
      await sleep(350);
    }
    return { ok: false, error: last?.error || "relay did not become healthy in time" };
  }

  async #scheduleRestart(code, signal) {
    if (this.restartCount >= BACKOFFS.length) {
      this.lastError = `relay crashed ${this.restartCount + 1}x (code=${code} signal=${signal ?? "-"}); giving up`;
      this.#set("crashed", "restart budget exhausted");
      this.log.push({ level: "error", source: "panel", message: `[relay] ${this.lastError}` });
      return;
    }
    const delay = BACKOFFS[this.restartCount] ?? 4000;
    this.restartCount += 1;
    this.log.push({
      level: "warn",
      source: "panel",
      message: `[relay] auto-restart ${this.restartCount}/${BACKOFFS.length} in ${delay}ms`,
    });
    this.#event("restart_scheduled", { attempt: this.restartCount, delayMs: delay });
    await sleep(delay);
    if (this.shutdownRequested || this.state === "stopping") return;
    await this.start({ force: true });
  }

  #terminate(child) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve();
      };
      child.once("exit", done);
      const killTimer = setTimeout(() => {
        this.log.push({ level: "warn", source: "panel", message: `[relay] SIGKILL pid=${child.pid} after ${STOP_GRACE_MS}ms` });
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        setTimeout(done, 500);
      }, STOP_GRACE_MS);
      killTimer.unref?.();
      try {
        child.kill("SIGTERM");
      } catch {
        done();
      }
    });
  }

  startHealthLoop(intervalMs = HEALTH_EVERY_MS) {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => void this.#healthTick(), intervalMs);
    this.healthTimer.unref?.();
  }

  stopHealthLoop() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  async #healthTick() {
    const health = await this.probe(2500);
    const wasHealthy = this.healthMisses === 0;
    if (health.ok) {
      if (!wasHealthy && this.state === "running") {
        this.log.push({ level: "info", source: "panel", message: "[relay] health recovered" });
      }
      this.healthMisses = 0;
      if (this.state === "stopped") {
        // Something answered on our port — adopt it.
        this.owned = false;
        this.startedAt = Date.now();
        this.#set("running", "adopted external relay (health loop)");
      }
      this.emit({ type: "health", data: this.status() });
      return;
    }
    this.healthMisses += 1;
    if (this.state === "running" && wasHealthy) {
      this.log.push({
        level: "warn",
        source: "panel",
        message: `[relay] health check failed: ${health.error || `HTTP ${health.status}`}`,
      });
    }
    if (this.state === "running" && this.healthMisses >= 3 && this.owned && this.child) {
      this.log.push({ level: "error", source: "panel", message: "[relay] unresponsive 3x — restarting" });
      await this.restart();
      return;
    }
    if (this.state === "running" && this.healthMisses >= 3 && !this.child) {
      this.#set("stopped", "external relay disappeared");
    }
    this.emit({ type: "health", data: this.status() });
  }

  /** Called from the sidecar's SIGTERM/SIGINT handler. */
  async shutdown() {
    this.shutdownRequested = true;
    this.stopHealthLoop();
    if (this.child && this.owned) {
      await this.#terminate(this.child);
      this.#event("shutdown", { pid: this.pid });
    }
    this.child = null;
    this.pid = null;
    this.state = "stopped";
  }
}

export function getRelayManager(opts) {
  if (!globalThis.__polPanelRelay) globalThis.__polPanelRelay = new RelayManager(opts);
  return globalThis.__polPanelRelay;
}

export const __test = { BACKOFFS, HEALTH_EVERY_MS, START_TIMEOUT_MS };
