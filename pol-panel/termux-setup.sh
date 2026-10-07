#!/usr/bin/env bash
# termux-setup.sh — one-shot bootstrap for Android/Termux.
#
#   bash pol-panel/termux-setup.sh     # install deps + build the panel
#   bash pol-panel/termux-start.sh     # run it
#
# Everything stays inside $HOME/zes-relay; no root, no termux-services needed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

echo "→ repo:    $REPO"
echo "→ panel:   $HERE"

if ! command -v pkg >/dev/null 2>&1; then
  echo "✗ This script expects Termux (pkg not found)." >&2
  exit 1
fi

echo "→ installing system packages (nodejs-lts, python, git)"
pkg install -y nodejs-lts python git

echo "→ node:  $(node -v)"
echo "→ npm:   $(npm -v)"
echo "→ python: $(python -V 2>&1)"

cd "$HERE"

echo "→ installing npm dependencies (this is the slow part on a phone)"
npm install --no-audit --no-fund --omit=optional

echo "→ building the production bundle"
# Vite's default heap is fine, but Termux devices are often tight on RAM.
NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=768" npm run build

cat <<EOF

✓ done.

  start the panel:   bash pol-panel/termux-start.sh
  then open:         http://127.0.0.1:7178

First-run credentials are printed by the sidecar and written to
  $REPO/data/FIRST-RUN.txt   (mode 0600)

Reach the panel from another device on the same Wi-Fi:
  PANEL_ALLOW_PUBLIC=true PANEL_HOST=0.0.0.0 bash pol-panel/termux-start.sh
EOF
