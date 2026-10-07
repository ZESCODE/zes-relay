/**
 * config-store.mjs — read/validate/write data/.env for the relay child process.
 *
 * Precedence (highest wins): process environment → data/.env → documented default.
 * Secrets are never returned in plain text except through the audited reveal
 * endpoint (routes/config.mjs → GET /api/config/reveal).
 */
import fs from "node:fs";
import { PATHS, writeTextAtomic, readTextIfExists } from "./fs-paths.mjs";

export const ENV_KEYS = [
  {
    key: "POL_RELAY_PORT",
    label: "Relay port",
    type: "int",
    min: 1,
    max: 65535,
    def: "7179",
    hint: "127.0.0.1 port the Python relay listens on.",
  },
  {
    key: "POL_UPSTREAM_BASE",
    label: "Upstream base URL",
    type: "url",
    def: "https://gen.pollinations.ai/v1",
    hint: "OpenAI-compatible upstream the relay proxies to.",
  },
  {
    key: "POL_API_KEY",
    label: "Upstream API key",
    type: "string",
    secret: true,
    def: "",
    hint: "Sent as Authorization: Bearer … unless POL_SKIP_AUTH=true.",
  },
  {
    key: "POL_SKIP_AUTH",
    label: "Skip relay auth",
    type: "bool",
    def: "true",
    hint: "When true the relay forwards the caller's Authorization header.",
  },
  {
    key: "POL_DATA_DIR",
    label: "Relay data dir",
    type: "path",
    def: "",
    hint: "Where models.json lives. Empty = <repo>/data.",
  },
  {
    key: "POL_MODEL_CACHE_TTL",
    label: "Model cache TTL (s)",
    type: "int",
    min: 1,
    max: 86400,
    def: "60",
    hint: "Seconds /v1/models is cached upstream.",
  },
  {
    key: "POL_UPSTREAM_TIMEOUT",
    label: "Upstream timeout (s)",
    type: "int",
    min: 1,
    max: 86400,
    def: "600",
    hint: "Socket timeout for chat completions.",
  },
];

const KEY_NAMES = ENV_KEYS.map((k) => k.key);

export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function serializeEnv(values, header = "# Managed by pol-panel. Hand edits are preserved on save.\n") {
  const lines = [header];
  for (const spec of ENV_KEYS) {
    const value = values[spec.key];
    if (value === undefined || value === "") {
      lines.push(`# ${spec.key}=`);
      continue;
    }
    lines.push(`${spec.key}=${String(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function validateOne(spec, raw) {
  const value = raw === undefined ? "" : String(raw).trim();
  if (value === "") return { ok: true, value: "" };
  switch (spec.type) {
    case "int": {
      if (!/^-?\d+$/.test(value)) return { ok: false, message: `${spec.label} must be an integer` };
      const n = Number(value);
      if (n < spec.min || n > spec.max) {
        return { ok: false, message: `${spec.label} must be between ${spec.min} and ${spec.max}` };
      }
      return { ok: true, value };
    }
    case "bool": {
      if (!["true", "false", "1", "0"].includes(value.toLowerCase())) {
        return { ok: false, message: `${spec.label} must be true or false` };
      }
      return { ok: true, value: value.toLowerCase() === "true" || value === "1" ? "true" : "false" };
    }
    case "url": {
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return { ok: false, message: `${spec.label} must be a valid URL` };
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { ok: false, message: `${spec.label} must use http or https` };
      }
      return { ok: true, value: value.replace(/\/+$/, "") };
    }
    case "path": {
      if (value.includes("\n") || value.includes("\0")) {
        return { ok: false, message: `${spec.label} contains invalid characters` };
      }
      return { ok: true, value };
    }
    default:
      return { ok: true, value };
  }
}

export function validateConfig(values) {
  const errors = [];
  const cleaned = {};
  for (const spec of ENV_KEYS) {
    const result = validateOne(spec, values[spec.key]);
    if (!result.ok) {
      errors.push({ key: spec.key, message: result.message });
      continue;
    }
    cleaned[spec.key] = result.value;
  }
  const port = Number(cleaned.POL_RELAY_PORT || 0);
  const panelPort = Number(process.env.PANEL_PORT || 7178);
  if (port && port === panelPort) {
    errors.push({
      key: "POL_RELAY_PORT",
      message: `Relay port ${port} collides with the panel port ${panelPort}`,
    });
  }
  if (cleaned.POL_SKIP_AUTH !== "true" && !cleaned.POL_API_KEY && !process.env.POL_API_KEY) {
    errors.push({
      key: "POL_API_KEY",
      message: "POL_SKIP_AUTH is false but no POL_API_KEY is configured",
    });
  }
  return { ok: errors.length === 0, errors, values: cleaned };
}

export function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(Math.min(12, s.length - 8))}${s.slice(-4)}`;
}

export class ConfigStore {
  constructor({ file = PATHS.envFile } = {}) {
    this.file = file;
  }

  /** Values as stored in data/.env (no defaults, no process env). */
  fileValues() {
    return parseEnvFile(readTextIfExists(this.file) || "");
  }

  /** Effective values: process env → file → default. */
  read() {
    const file = this.fileValues();
    const values = {};
    const source = {};
    for (const spec of ENV_KEYS) {
      if (process.env[spec.key] !== undefined && process.env[spec.key] !== "") {
        values[spec.key] = process.env[spec.key];
        source[spec.key] = "process";
      } else if (file[spec.key] !== undefined && file[spec.key] !== "") {
        values[spec.key] = file[spec.key];
        source[spec.key] = "file";
      } else {
        values[spec.key] = spec.def;
        source[spec.key] = "default";
      }
    }
    return { values, source, file };
  }

  /** Same shape as read() but with secrets masked — safe for the browser. */
  readMasked() {
    const { values, source } = this.read();
    const masked = { ...values };
    for (const spec of ENV_KEYS) {
      if (spec.secret) masked[spec.key] = maskSecret(values[spec.key]);
    }
    return { values: masked, source, specs: ENV_KEYS };
  }

  /** Audited plaintext read of one secret. */
  reveal(key) {
    const spec = ENV_KEYS.find((s) => s.key === key);
    if (!spec || !spec.secret) return { ok: false, code: "not_secret", message: `${key} is not a secret` };
    const { values } = this.read();
    return { ok: true, value: values[key] || "" };
  }

  write(values) {
    const check = validateConfig(values);
    if (!check.ok) return { ok: false, errors: check.errors };
    // Preserve file-only keys (comments/hand edits) by starting from the file.
    const current = this.fileValues();
    const next = { ...current };
    for (const key of KEY_NAMES) {
      const incoming = check.values[key];
      if (incoming === undefined) continue;
      if (incoming === "") delete next[key];
      else next[key] = incoming;
    }
    writeTextAtomic(this.file, serializeEnv(next));
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort */
    }
    return { ok: true, file: next };
  }

  /** Environment handed to the spawned relay. */
  relayEnv() {
    const { values } = this.read();
    const env = {};
    for (const spec of ENV_KEYS) {
      if (values[spec.key] !== "") env[spec.key] = values[spec.key];
    }
    return env;
  }

  /** Diff effective config against what the running relay was started with. */
  diff(runningEnv = {}) {
    const { values, source } = this.read();
    const rows = [];
    for (const spec of ENV_KEYS) {
      const running = runningEnv[spec.key] ?? "";
      const effective = values[spec.key] ?? "";
      rows.push({
        key: spec.key,
        label: spec.label,
        type: spec.type,
        secret: Boolean(spec.secret),
        source: source[spec.key],
        effective: spec.secret ? maskSecret(effective) : effective,
        running: spec.secret ? maskSecret(running) : running,
        changed: effective !== running,
      });
    }
    return { rows, changed: rows.some((r) => r.changed) };
  }
}

export function getConfigStore(opts) {
  if (!globalThis.__polPanelConfig) globalThis.__polPanelConfig = new ConfigStore(opts);
  return globalThis.__polPanelConfig;
}
