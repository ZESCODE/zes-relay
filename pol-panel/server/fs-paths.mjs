/**
 * Deterministic filesystem layout for the panel sidecar.
 *
 * Everything mutable lives under <repo>/data (mode 0700). The relay itself
 * defaults POL_DATA_DIR to the same directory, so the panel and the relay share
 * data/models.json — the panel is a client of the relay's state, never a
 * second writer of it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PANEL_DIR = path.resolve(HERE, "..");
export const REPO_DIR = path.resolve(PANEL_DIR, "..");

const resolvedDataDir = process.env.POL_DATA_DIR
  ? path.resolve(process.env.POL_DATA_DIR)
  : path.join(REPO_DIR, "data");

export const PATHS = {
  panelDir: PANEL_DIR,
  repoDir: REPO_DIR,
  dataDir: resolvedDataDir,
  logsDir: path.join(resolvedDataDir, "logs"),
  presetsDir: path.join(resolvedDataDir, "presets"),
  backupsDir: path.join(resolvedDataDir, "backups"),
  envFile: path.join(resolvedDataDir, ".env"),
  usersFile: path.join(resolvedDataDir, "users.json"),
  tokensFile: path.join(resolvedDataDir, "tokens.json"),
  eventsFile: path.join(resolvedDataDir, "events.jsonl"),
  secretsFile: path.join(resolvedDataDir, "secrets.json"),
  firstRunFile: path.join(resolvedDataDir, "FIRST-RUN.txt"),
  panelLog: path.join(resolvedDataDir, "logs", "panel.jsonl"),
  relayScript: path.resolve(
    REPO_DIR,
    process.env.POL_RELAY_SCRIPT || "pol_relay.py",
  ),
  relayCwd: process.env.POL_RELAY_CWD
    ? path.resolve(process.env.POL_RELAY_CWD)
    : REPO_DIR,
  distDir: path.join(PANEL_DIR, "dist"),
};

/** Create the runtime tree with 0700 permissions. Idempotent. */
export function ensureDataDirs() {
  for (const dir of [
    PATHS.dataDir,
    PATHS.logsDir,
    PATHS.presetsDir,
    PATHS.backupsDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* best effort — some filesystems (Termux/sdcard) ignore chmod */
    }
  }
  return PATHS;
}

export function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Atomic JSON write: temp file + rename, so a crash never truncates state. */
export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
}

export function writeTextAtomic(file, text, mode = 0o600) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, mode);
  } catch {
    /* best effort */
  }
}

export function appendLine(file, text) {
  try {
    fs.appendFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    /* never let logging crash the panel */
  }
}

export function sha256File(file) {
  try {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex");
  } catch {
    return null;
  }
}

/** Size-rotate a log file: panel.jsonl -> panel.1.jsonl -> dropped. */
export function rotateIfNeeded(file, maxBytes = 5 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (stat.size < maxBytes) return false;
    const rotated = file.replace(/\.jsonl$/, ".1.jsonl");
    fs.renameSync(file, rotated);
    return true;
  } catch {
    return false;
  }
}

export function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}
