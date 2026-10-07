#!/usr/bin/env bash
# termux-start.sh — run the built panel + relay in the foreground.
#
#   bash pol-panel/termux-start.sh
#
# Env overrides (all optional):
#   PANEL_PORT=7178            panel + API port
#   PANEL_HOST=127.0.0.1       set to 0.0.0.0 with PANEL_ALLOW_PUBLIC=true for LAN
#   POL_RELAY_PORT=7179        relay port (127.0.0.1 only, always)
#   POL_UPSTREAM_BASE=...      OpenAI-compatible upstream
#   POL_API_KEY=...            upstream key (only when POL_SKIP_AUTH=false)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -d "$HERE/dist" ]; then
  echo "✗ $HERE/dist not found — run: bash pol-panel/termux-setup.sh" >&2
  exit 1
fi

cd "$HERE"
export NODE_ENV=production
export PANEL_PORT="${PANEL_PORT:-7178}"
export PANEL_HOST="${PANEL_HOST:-127.0.0.1}"
export PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "→ panel   http://127.0.0.1:${PANEL_PORT}"
echo "→ relay   127.0.0.1:${POL_RELAY_PORT:-7179}"
exec node server/index.mjs
