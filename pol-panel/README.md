# pol-panel — control panel for `pol_relay.py`

A Vite + React 18 + TypeScript dashboard for the [zes-relay](../README.md) OpenAI-compatible relay,
with a Node/Express sidecar as its only backend. **Headline feature: per-model activation toggles
plus a one-click "test all models" flow.**

Built **mobile-first for Android/Termux**: bottom tab bar, 44 px tap targets, safe-area insets,
no native npm modules, no canvas, and a ~105 kB app bundle.

```
┌────────────┐   /api/*    ┌──────────────────┐  127.0.0.1:7179  ┌──────────────┐   https   ┌──────────┐
│  Browser   │ ──────────▶ │ Node sidecar     │ ───────────────▶ │ pol_relay.py │ ────────▶ │ upstream │
│ (React)    │ ◀────────── │ server/index.mjs │ ◀─────────────── │  (Python)    │ ◀──────── │ (LLM)    │
└────────────┘   SSE/fetch └──────────────────┘                  └──────────────┘           └──────────┘
                                   │
                                   └── data/  (.env, models.json, logs, presets, backups, events.jsonl)
```

The browser **never** talks to the relay. The sidecar owns the filesystem, the child process and
every upstream credential.

---

## Quick start

```bash
cd pol-panel
npm install

# development: Vite on :7177 proxying /api and /admin to the sidecar on :7178
npm run dev

# production: build once, then the sidecar serves dist/ + the API on one port
npm run build
npm start          # → http://127.0.0.1:7178
```

On first boot the sidecar creates the admin account:

* `PANEL_ADMIN_USER` / `PANEL_ADMIN_PASSWORD` set → that account is created.
* otherwise a one-time password is **printed to the sidecar log** and written to
  `data/FIRST-RUN.txt` (mode `0600`). Delete the file after your first login.

### Termux (Android)

```bash
git clone https://github.com/ZESCODE/zes-relay && cd zes-relay
bash pol-panel/termux-setup.sh      # pkg install nodejs-lts python git; npm install; build
bash pol-panel/termux-start.sh      # run → http://127.0.0.1:7178
```

Open `http://127.0.0.1:7178` in the phone's browser, or *Add to Home screen* for a full-screen app.
To reach the panel from another device on the same Wi‑Fi:

```bash
PANEL_ALLOW_PUBLIC=true PANEL_HOST=0.0.0.0 bash pol-panel/termux-start.sh
```

The panel refuses to bind `0.0.0.0` unless `PANEL_ALLOW_PUBLIC=true`; the **relay always stays on
`127.0.0.1`**.

### Docker

```bash
docker compose -f pol-panel/docker-compose.yml up --build     # → http://127.0.0.1:7178
docker logs pol-panel                                         # first-run password
```

### No network? Use the bundled mock upstream

`scripts/mock-upstream.mjs` is a tiny OpenAI-compatible upstream (9 models, streaming, two
deliberately broken ones) for offline development and demos:

```bash
node scripts/mock-upstream.mjs                                   # 127.0.0.1:7290
POL_UPSTREAM_BASE=http://127.0.0.1:7290/v1 npm start
```

---

## Environment variables

Every knob has an env var; the panel writes the `POL_*` ones to `data/.env` from the Config page.
Precedence: **process environment → `data/.env` → documented default.**

### Panel sidecar

| Variable | Default | Description |
| --- | --- | --- |
| `PANEL_PORT` | `7178` | Port for the API and (in production) the built assets. |
| `PANEL_HOST` | `127.0.0.1` | Bind address. `0.0.0.0` requires `PANEL_ALLOW_PUBLIC=true`. |
| `PANEL_ALLOW_PUBLIC` | `false` | Required to bind a public address. |
| `PANEL_DEV_PORT` | `7177` | Vite dev server port. |
| `PANEL_DEV_HOST` | `0.0.0.0` | Vite dev host (any `Host` header is accepted for phone previews). |
| `PANEL_ADMIN_USER` | `admin` | First-run admin username. |
| `PANEL_ADMIN_PASSWORD` | *(generated)* | First-run password. If unset, one is generated and logged. |
| `PANEL_SESSION_HOURS` | `72` | Session cookie lifetime. |
| `PANEL_SESSION_SECRET` | *(generated)* | HMAC key for session cookies; persisted in `data/secrets.json`. |
| `PANEL_LOGIN_RPM` | `5` | Login attempts per minute per IP. |
| `PANEL_CHAT_RPM` | `30` | Playground requests per minute per user. |
| `PANEL_ACCESS_LOG` | `true` | Log non-trivial requests into the log bus. |
| `PANEL_AUTOSTART` | `true` | Start (or adopt) the relay when the sidecar boots. |
| `PANEL_ADOPT_EXTERNAL` | `true` | Adopt a relay already listening on `POL_RELAY_PORT`. |
| `PYTHON_BIN` | `python3` | Interpreter used to run the relay. |
| `POL_RELAY_SCRIPT` | `pol_relay.py` | Relay script, resolved against the repo root. |
| `POL_RELAY_CWD` | repo root | Working directory for the relay child. |
| `MOCK_PORT` / `MOCK_HOST` | `7290` / `127.0.0.1` | Mock upstream listener. |

### Relay (edited on the Config page, stored in `data/.env`)

| Variable | Default | Validation |
| --- | --- | --- |
| `POL_RELAY_PORT` | `7179` | integer 1–65535, must not equal `PANEL_PORT`. |
| `POL_UPSTREAM_BASE` | `https://gen.pollinations.ai/v1` | must parse as `http`/`https`. |
| `POL_API_KEY` | *(empty)* | masked everywhere; reveal is audited. Required when `POL_SKIP_AUTH=false`. |
| `POL_SKIP_AUTH` | `true` | `true`/`false`. |
| `POL_DATA_DIR` | `<repo>/data` | path; shared with the panel. |
| `POL_MODEL_CACHE_TTL` | `60` | integer 1–86400 seconds. |
| `POL_UPSTREAM_TIMEOUT` | `600` | integer 1–86400 seconds. |

---

## Endpoints

All responses use the relay's envelope: `{ok:true,data}` or `{ok:false,error:{code,message}}`.
**HTTP 200 means success** — including a toggle that lands on `enabled:false`. Read `data.enabled`.

### Panel API (session cookie or `Authorization: Bearer pp_…`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Panel liveness (no auth). |
| POST | `/api/auth/login` · `/logout` · `/password` · `/theme` | Session management. |
| GET | `/api/auth/me` · `/api/auth/csrf` | Current user + CSRF token. |
| GET | `/api/relay/status` | Lifecycle state, pid, health, restart count. |
| POST | `/api/relay/start` · `/stop` · `/restart` · `/kill-external` | Idempotent lifecycle control. |
| GET | `/api/relay/events` · `/api/relay/stream` | `events.jsonl` tail and live status SSE. |
| GET | `/api/models` | Annotated model list from the relay. |
| GET | `/api/models/available?all=true` | Enabled-only (or all) models for dropdowns. |
| GET | `/api/models/disabled` | Disabled ids + last test results. |
| POST | `/api/models/enable` · `/disable` · `/toggle` · `/reset` | Mutations, `{id,enabled}` back. |
| POST | `/api/models/test` | Test one model. |
| POST | `/api/models/test-all` | Test everything, single JSON response. |
| GET | `/api/models/test-all/stream?mode=sequential\|batch` | Same, streamed row by row. |
| GET | `/api/models/stream` | Invalidation SSE so all tabs stay in sync. |
| POST | `/api/chat` | Playground proxy (streaming + non-streaming). |
| GET | `/api/metrics/summary` · `/timeseries?range=1h\|6h\|24h` · `/models` · `/endpoints` · `/errors` | Metrics. |
| GET/POST | `/api/metrics/stream` · `/api/metrics/clear` | 2 s SSE push / reset. |
| GET | `/api/logs` · `/api/logs/stream` · `/api/logs/download` | Merged log buffer. |
| POST | `/api/logs/clear` | Clear the in-memory buffer. |
| GET/POST | `/api/config` · `/api/config/save-restart` | Read (masked) / write `data/.env`. |
| POST | `/api/config/reveal` | Plaintext secret, written to the audit log. |
| GET | `/api/admin/info` | Versions, `pol_relay.py` SHA-256, paths, counters. |
| GET/POST/DELETE | `/api/admin/tokens[/:id]` | API token lifecycle. |
| GET/POST | `/api/admin/export` · `/api/admin/import` | Settings JSON (secrets excluded by default). |
| POST | `/api/admin/clear` | Drop metrics and the log buffer. |
| GET/POST/DELETE | `/api/admin/backup` · `/api/admin/backups[/:name]` | ZIP backups of `data/`. |
| GET/POST/DELETE | `/api/presets[/:id]` | Playground presets in `data/presets/`. |
| ALL | `/admin/*` | Authenticated passthrough to the relay's own admin API. |

### Relay admin API (proxied, unchanged wire protocol)

| Method | Path | 200 means | Response |
| --- | --- | --- | --- |
| GET | `/admin/models` | list fetched | `{ok,data:[{id,enabled,last_test,…}]}` |
| GET | `/admin/models/disabled` | ok | `{ok,data:{disabled:[],tests:{}}}` |
| POST | `/admin/models/enable` | **the model is now enabled** | `{ok,data:{id,enabled:true}}` |
| POST | `/admin/models/disable` | **the model is now disabled** | `{ok,data:{id,enabled:false}}` |
| POST | `/admin/models/toggle` | **state flipped — check `data.enabled`** | `{ok,data:{id,enabled}}` |
| POST | `/admin/models/test` | test ran (pass *or* fail) | `{ok,data:{id,ok,status,latency_ms,ts,error?}}` |
| POST | `/admin/models/test-all` | all tests ran | `{ok,data:{tested,results:{id:{…}}}}` |
| POST | `/admin/models/reset` | disabled set cleared | `{ok,data:{disabled:[]}}` |
| POST | `/v1/chat/completions` | completion returned | OpenAI shape, or 403 `model_disabled`. |

Non-200 only happens on real errors: `400 bad_request`, `401 unauthorized`, `403 model_disabled`,
`404 not_found`, `429 rate_limited`, `5xx upstream_error`.

---

## Features

**Models (the star).** One row per model with id, owner, enabled state, last test result and a
`role="switch"` toggle. Toggles are optimistic, debounced 300 ms per model, disabled while in
flight, and always reconciled to `data.enabled` — if the relay disagrees, the relay wins and a
warning toast fires. Bulk enable/disable run sequentially, reset asks for confirmation, filter
chips (All / Enabled / Disabled / Failing) persist to `localStorage`, and the list is windowed so
300 glass cards never stutter.

**Test all.** Row-by-row mode issues one `POST /admin/models/test` per model so results land as
they happen and *Cancel actually stops the remaining work*; batch mode calls the relay's single
`test-all` and re-emits the finished map row by row over SSE. A progress bar shows `n/total`,
passed and failed; afterwards the table sorts failure-first, then by latency.

**Playground.** Model dropdown fed by `GET /v1/models` (relay already filters to enabled), with an
opt-in "Show disabled" list that is greyed out and blocked client-side. Message editor with
add/remove/reorder, full sampling parameters, token-by-token streaming through a hand-rolled SSE
parser, TTFB + total timers, usage chips, raw request/response panes, presets in
`data/presets/`, and a red `model_disabled` banner with an **Enable this model now** button that
retries the request on success.

**Dashboard.** 2 s SSE tiles (requests, errors, p50/p95/p99, tokens, active streams, bytes, uptime,
last error), request/error bars and a latency chart with 1 h/6 h/24 h ranges, per-model traffic,
recent errors and the relay lifecycle feed. Polling pauses when the tab is hidden.

**Logs.** Relay stdout/stderr and the sidecar access log merged into one ring buffer, live over
SSE, filterable by level, source, substring or regex and time range, with freeze, auto-scroll,
windowed rendering and `.log` download. `Bearer …`, `sk-…`, `api_key` and `password` are redacted
on the way in.

**Config.** Validated editor for `data/.env` with a live diff against the values the running relay
was started with, masked secrets with an audited reveal, and *Save & restart relay*.

**Admin.** Runtime info (panel/Node/Python versions, SHA-256 of `pol_relay.py`), relay lifecycle
controls, API tokens, settings export/import, metrics/log clearing and ZIP backups of `data/`.

**Security.** scrypt password hashing, HMAC-signed httpOnly `SameSite=Lax` cookies (no tokens in
`localStorage`), CSRF double-submit plus Origin check on state-changing routes, `timingSafeEqual`
comparisons, login and chat rate limits, strict CSP and friends, `127.0.0.1`-only relay, and an
audit trail for secret reveals, token changes and destructive actions.

**Keyboard.** `g d/m/p/l/c/a` to navigate, `?` for help; on Models `t` tests all, `e` enables all,
`x` disables all, `/` focuses search.

---

## Mobile / Termux notes

* **No native modules.** No `better-sqlite3`, `bcrypt`, `archiver` or `sharp` — nothing to compile
  on ARM. Backups use a small built-in ZIP writer (`server/zip.mjs`), passwords use `crypto.scrypt`.
* **No Recharts.** Charts are hand-rolled SVG (`components/charts/`), ~0 kB of dependency instead
  of ~120 kB gzipped, with axis labels in HTML so they never distort.
* **Cheap glass.** `backdrop-filter` blur drops from 20 px to 8 px under 768 px and hover
  transforms are disabled on touch, because blur is the most expensive effect in this design.
* **Touch geometry.** 44 px minimum tap targets, 16 px inputs (no iOS zoom), `touch-action:
  manipulation`, `overscroll-behavior-y: none`, `100dvh` layouts, safe-area padding on the tab bar,
  toasts and modals (bottom sheets on phones).
* **Windowed lists.** Models and logs render a page at a time with "show more".
* **Battery.** Every poll and SSE stream pauses on `visibilitychange`; models and relay state are
  shared stores with a single socket each rather than one per component.
* **Build memory.** `termux-setup.sh` sets `--max-old-space-size=768` for the Vite build.

---

## Development

```bash
npm run dev         # Vite + sidecar, no extra process manager
npm run build       # tsc -b && vite build
npm run typecheck   # tsc --noEmit
npm test            # vitest: relay-manager, metrics, models flow, UI
```

`npm test` runs 30 tests:

| File | What it proves |
| --- | --- |
| `tests/metrics.test.mjs` | Ring buffers, counters, percentiles, timeseries buckets, error list. |
| `tests/relay-manager.test.mjs` | Spawn → health → own, idempotent start, SIGTERM stop, **adoption of an external relay and refusal to kill it**, `events.jsonl`, exponential-backoff auto-restart. |
| `tests/models-flow.test.mjs` | Real `pol_relay.py` + mock upstream: toggle off → chat **403 `model_disabled`** → toggle on → chat **200**, `/v1/models` filtering, test-all SSE, CSRF/auth, `models.json` persistence. |
| `tests/ui.test.tsx` | Mounts the real app in jsdom against a live sidecar: the Models page renders one switch per model, clicking a switch flips it and the relay persists it, and the dashboard tiles render from the metrics stream. |

---

## Deviations from `BUILD-PROMPT.md`

Deliberate, and each one is a mobile/Termux call:

1. **Recharts → hand-rolled SVG** (see above). No canvas was ever used.
2. **`archiver` → `server/zip.mjs`.** A 100-line dependency-free ZIP writer for backups.
3. **`react-window` → manual windowing.** Fewer deps, same effect at this scale.
4. **Extra files:** `server/envelope.mjs`, `server/relay-client.mjs`, `server/zip.mjs`,
   `server/routes/presets.mjs`, `components/ui/Icon.tsx`, `components/ui/Select.tsx`,
   `components/layout/MobileTabBar.tsx`, `lib/hooks/useRelay.ts`, `lib/hooks/useSession.ts`,
   `lib/hooks/useTheme.ts`, `scripts/dev.mjs`, `scripts/mock-upstream.mjs`,
   `termux-setup.sh`, `termux-start.sh`, `public/theme.js`. Everything the prompt lists exists.
5. **`test-all` has two modes.** Row-by-row is the default because Cancel must actually stop work;
   batch mode is the literal `POST /admin/models/test-all` re-emitted over SSE.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Cannot reach the panel sidecar" in a toast | The sidecar is down. `npm start` (prod) or `npm run dev`, then reload. |
| Login says *invalid credentials* on first run | Read the password from the sidecar log or `data/FIRST-RUN.txt`. |
| Model list is empty | The relay cannot reach `POL_UPSTREAM_BASE`. Check it on the Config page, or try the mock upstream. |
| `relay_start_failed` / banner says crashed | `python3` missing (`pkg install python` on Termux) or the port is taken: `POL_RELAY_PORT=7180`. |
| Banner says "Relay adopted" | Something else already listens on `POL_RELAY_PORT`; the panel will not kill it without the double-confirmed *Force kill*. |
| Port in use | `PANEL_PORT=7188 npm start`. |
| Everything 403s with `csrf` | Stale tab after a server restart — reload so the CSRF cookie is reissued. |
| Blank page behind a proxy | The panel sets a strict CSP; make sure the proxy does not inject inline scripts. |
| Logs are quiet | `PANEL_ACCESS_LOG=true` (default) and check the level/source filters. |

---

## Screenshots

_Dark theme, phone width (390 px) — Models, Dashboard, Playground:_

| Models | Dashboard | Playground |
| --- | --- | --- |
| _todo_ | _todo_ | _todo_ |

---

## License

MIT — see [../LICENSE](../LICENSE).
