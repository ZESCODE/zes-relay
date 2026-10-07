#!/usr/bin/env node
/**
 * scripts/dev.mjs — run the Node sidecar and the Vite dev server together
 * without pulling in `concurrently` (one less dependency to install on Termux).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const PANEL_PORT = process.env.PANEL_PORT ?? "7178";
const PANEL_DEV_PORT = process.env.PANEL_DEV_PORT ?? "7177";

const children = [];

function run(name, command, args, color) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", PANEL_PORT, PANEL_DEV_PORT, FORCE_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, target) => {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    process.stdout.write(`${prefix}exited code=${code} signal=${signal ?? "-"}\n`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 400).unref?.();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("sidecar", process.execPath, ["server/index.mjs"], "36");
run("vite", process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js")], "35");

process.stdout.write(
  `\n  panel dev: http://127.0.0.1:${PANEL_DEV_PORT}  (API proxied to :${PANEL_PORT})\n\n`,
);
