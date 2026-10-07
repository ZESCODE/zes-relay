You are a senior TypeScript/React engineer. Build a production-quality Vite + React 18 + TypeScript control panel dashboard for pol_relay.py. The dashboard's headline feature is per-model activation toggles plus a one-click "test all models" flow. Deliver complete, runnable code with no placeholders, no TODOs, and no "left as an exercise" comments.

Design: frost design 
https://github.com/ZESCODE/frost-cards
---

1. Context you must respect

pol_relay.py v2.0 is a ThreadingHTTPServer on 127.0.0.1:${POL_RELAY_PORT:-7179} that:

· Proxies POST /v1/chat/completions (streaming and non-streaming) and GET /v1/models to POL_UPSTREAM_BASE.
· Maintains a persistent disabled-model set in data/models.json.
· Filters /v1/models to enabled models only by default (?all=true includes disabled).
· Exposes /admin/models/* for enable/disable/toggle/test/test-all/reset.
· Returns envelopes: {ok:true,data} / {ok:false,error:{code,message}}.
· Rejects disabled models on chat with 403 model_disabled.
· Has /health for liveness.
· Logs to stderr with the [pol-relay] prefix.

Every admin mutation returns HTTP 200 on success — even a toggle that results in "disabled" state is a successful 200 {ok:true, data:{id, enabled:false}}. Non-200 responses only occur on real errors (400 bad request, 401 unauthorized, 403 forbidden model, 404 unknown route, 5xx upstream). The dashboard must treat 200 as success and read data.enabled to know the resulting state.

Do not modify the relay's wire protocol. The dashboard talks to it over HTTP from a Node/Express sidecar (see §4). The browser never talks to the relay directly.

---

2. Deliverables (create every file)

```
pol-panel/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .env.example
├── .gitignore
├── README.md
├── Dockerfile
├── docker-compose.yml
├── server/                              # Node sidecar (Express)
│   ├── index.mjs
│   ├── relay-manager.mjs
│   ├── metrics.mjs
│   ├── log-bus.mjs
│   ├── config-store.mjs
│   ├── token-store.mjs
│   ├── auth.mjs
│   ├── rate-limit.mjs
│   ├── fs-paths.mjs
│   └── routes/
│       ├── auth.mjs
│       ├── relay.mjs
│       ├── models.mjs
│       ├── chat.mjs
│       ├── metrics.mjs
│       ├── logs.mjs
│       ├── config.mjs
│       └── admin.mjs
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── router.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   ├── sse.ts
│   │   ├── types.ts
│   │   ├── format.ts
│   │   └── hooks/
│   │       ├── useSSE.ts
│   │       ├── useInterval.ts
│   │       ├── useToast.ts
│   │       └── useModels.ts
│   ├── components/
│   │   ├── ui/                          # Button, Card, Switch, Input, Modal, Toast, Badge, Tabs, Spinner
│   │   ├── layout/Shell.tsx
│   │   ├── layout/Sidebar.tsx
│   │   ├── layout/TopBar.tsx
│   │   ├── models/ModelTable.tsx
│   │   ├── models/ModelRow.tsx
│   │   ├── models/ModelToggle.tsx       # the star of the show
│   │   ├── models/TestAllButton.tsx
│   │   ├── models/TestBadge.tsx
│   │   ├── dashboard/StatTile.tsx
│   │   ├── dashboard/HealthBadge.tsx
│   │   ├── charts/LatencyChart.tsx
│   │   ├── charts/RequestsChart.tsx
│   │   ├── chat/ChatPanel.tsx
│   │   ├── chat/MessageList.tsx
│   │   ├── chat/ParamForm.tsx
│   │   ├── logs/LogViewer.tsx
│   │   ├── config/EnvEditor.tsx
│   │   └── admin/TokenTable.tsx
│   └── pages/
│       ├── Login.tsx
│       ├── Dashboard.tsx
│       ├── Models.tsx                   # dedicated model-control page
│       ├── Playground.tsx
│       ├── Logs.tsx
│       ├── Config.tsx
│       └── Admin.tsx
├── data/                                # gitignored runtime state
└── tests/
    ├── relay-manager.test.mjs
    ├── metrics.test.mjs
    └── models-flow.test.mjs             # toggle → chat → 403 → re-enable → 200
```

---

3. Required features

3.1 Per-model toggle (primary feature)

· A Models page with one row per model returned by GET /admin/models.
· Each row shows: id, owned_by (if present), enabled/disabled state, last test result (ok/latency/status), and a Switch toggle.
· Toggle is optimistic: flip immediately, fire POST /admin/models/toggle {id}, and:
  · on HTTP 200 with data.enabled === <expected> → confirm.
  · on HTTP 200 with mismatched data.enabled → reconcile to server truth.
  · on non-200 → revert and toast the error.message.
· Toggle must debounce per-model (ignore clicks within 300 ms) and disable itself while the request is in flight; show an inline spinner.
· Bulk actions toolbar:
  · Enable all — sequential POST /admin/models/enable for each disabled id.
  · Disable all — sequential POST /admin/models/disable for each enabled id.
  · Reset to default — POST /admin/models/reset (with confirm modal).
· Search + filter chips: All | Enabled | Disabled | Failing.
· Persist the last-used filter in localStorage.

3.2 Test all models

· TestAllButton posts POST /admin/models/test-all and streams results back to the UI as they arrive.
  · The relay returns the full map in one 200 body; the sidecar re-emits them as SSE so the UI updates row-by-row (see §4.5).
· Each row's TestBadge shows: ✅ ok + {latency}ms, ❌ {status} + tooltip with error, or ⏳ running.
· A per-row Test button hits POST /admin/models/test {id}.
· Progress bar: n/total tested, p passed, f failed.
· Cancel button aborts the SSE and marks remaining rows as idle.
· After the run, sort the table by failure-first, then latency ascending.

3.3 Only available models (chat & dropdowns)

· The playground's model dropdown is populated from GET /v1/models (enabled only — the relay already filters).
· Add a small "Show disabled" checkbox in the playground that, when on, calls GET /v1/models?all=true and renders disabled options with a [disabled] suffix and greyed styling. Selecting one is blocked client-side with a toast: "Model is disabled. Enable it on the Models page."
· If the currently-selected model becomes disabled (via another tab or the Models page), the playground immediately swaps to the first enabled model and toasts the change (use a shared useModels store with SSE invalidation).

3.4 Relay lifecycle (Node sidecar)

· RelayManager singleton on globalThis in server/relay-manager.mjs.
· Start/stop/restart python3 pol_relay.py via node:child_process.spawn.
· Adopt an external relay on the target port (GET /health returns 200) → mark owned:false, disable kill.
· Health check every 5 s; log transitions to log-bus.
· Graceful shutdown: SIGTERM → 5 s → SIGKILL.
· Auto-restart with exponential backoff (3 retries: 1 s → 2 s → 4 s).
· Persist lifecycle events to data/events.jsonl.
· Pipe relay stdout/stderr into log-bus with source tag relay.

3.5 Live metrics

· Ring buffers (3600 samples) + counters in server/metrics.mjs.
· Track: requests total, req/min, tokens in/out (parse usage from JSON and SSE usage chunk), errors by status, p50/p95/p99 latency, active streams, bytes relayed.
· Per-model breakdown and endpoint breakdown.
· Uptime, last-error timestamp, last-error message (500 chars max).
· Expose GET /api/metrics/summary, /timeseries?range=1h|6h|24h, /models, /errors.
· SSE at /api/metrics/stream pushing summary every 2 s.

3.6 Chat playground

· Model dropdown (see §3.3).
· Message editor: add/remove/reorder system/user/assistant.
· Params: temperature, top_p, max_tokens, presence/frequency penalty, seed, stop, stream toggle.
· Live token-by-token streaming via fetch + ReadableStream + hand-rolled SSE parser in src/lib/sse.ts. Do not use EventSource (it can't POST).
· Token usage display after completion.
· Latency timer (TTFB + total).
· Save/load presets as data/presets/<id>.json.
· Collapsible raw request / raw response JSON panes.
· Explicit handling: if the sidecar returns 403 model_disabled, render a red banner with a "Enable this model now" button that hits /api/models/toggle and retries the request on success.

3.7 Log viewer

· Merged subprocess stdout/stderr + sidecar access log in log-bus.
· Live SSE at /api/logs/stream.
· Filters: level, substring, regex toggle, time range.
· Highlight [pol-relay] prefix and upstream error lines.
· Download buffer as .log.
· Auto-scroll toggle, freeze button, windowed list (manual windowing or react-window).

3.8 Config editor

· Read/write data/.env for POL_RELAY_PORT, POL_UPSTREAM_BASE, POL_API_KEY, POL_SKIP_AUTH, POL_DATA_DIR, POL_MODEL_CACHE_TTL, POL_UPSTREAM_TIMEOUT.
· Mask POL_API_KEY; reveal-on-click via a dedicated audited endpoint.
· Validate port range, URL scheme, integer bounds before saving.
· Show diff vs. running values; Save & Restart button.

3.9 Auth & security

· Server-side sessions with signed, httpOnly, Secure (prod), SameSite=Lax cookies. Use iron-session or jose compact JWT — no localStorage tokens.
· Password hashing with bcryptjs or crypto.scrypt.
· First run: create admin from PANEL_ADMIN_USER/PANEL_ADMIN_PASSWORD, else generate a one-time password and print it to the sidecar log.
· Optional API tokens for /api/* (Authorization: Bearer …).
· CSRF: double-submit cookie + Origin check on state-changing routes.
· Rate limit login (5/min/IP) and chat (configurable) in server/rate-limit.mjs.
· Bind to 127.0.0.1; refuse 0.0.0.0 unless PANEL_ALLOW_PUBLIC=true.
· Security headers in the sidecar: X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy, strict CSP.
· Constant-time token compare (crypto.timingSafeEqual).
· All API responses use the same envelope as the relay: {ok,data} / {ok,error}.

3.10 Admin

· API token create/revoke/list with last-used timestamp.
· Export/import settings JSON (secrets excluded by default).
· Clear metrics/logs (confirm).
· Start/stop/restart buttons.
· Backup data/ to a timestamped zip; list; download.
· Show panel version, Node version, Python version, SHA-256 of pol_relay.py.

3.11 UX

· Tailwind CSS + a minimal hand-rolled UI kit (or Radix primitives).
· Dark theme default; light toggle persisted in a cookie (set server-side to avoid FOUC).
· Responsive; usable on mobile.
· Auto-refresh dashboard tiles every 2 s (SWR or custom hook); pause when tab hidden (visibilitychange).
· Charts: Recharts. No canvas.
· Toasts via context provider.
· Keyboard shortcuts: g d, g m (models), g p, g l, g c, ? help. On the Models page, t triggers Test all, e enables selected, x disables selected.
· Accessible: labels, focus rings, aria-live for toasts, switches use role="switch" + aria-checked.

---

4. Technical constraints

1. Vite + React 18 + TypeScript strict. No Next.js, no SSR framework.
2. Node/Express sidecar (server/index.mjs) is the only process that talks to the relay, the filesystem, or spawns subprocesses. Vite dev server proxies /api/* and /admin/* to it (vite.config.ts → server.proxy).
3. In production, the sidecar serves the built dist/ as static assets plus the API.
4. Node runtime only for sidecar; the browser bundle must never import from server/.
5. Persistence: JSON/JSONL under ./data/. SQLite via better-sqlite3 only if you need queries.
6. All shared mutable state in the sidecar guarded by a mutex or written by a single writer.
7. Structured JSON logs to data/logs/panel.jsonl (size-rotated) + human-readable stderr.
8. Every knob has an env var and a documented default in README.md.
9. Tests: vitest for relay-manager, metrics, and a models-flow integration test that:
   · spawns the real relay on a temp port,
   · toggles a model off,
   · asserts POST /v1/chat/completions for that model returns 403 model_disabled,
   · toggles it back on,
   · asserts chat returns 200 (mock upstream) — proving the 200-as-success contract.
10. HTTP 200 = success everywhere. The panel's API client (src/lib/api.ts) must:
    · treat res.status === 200 as success and parse {ok:true, data},
    · for non-200, parse {ok:false, error} and throw a typed ApiError with code, message, status,
    · never treat 200 with ok:false as success (defensive), and never treat 4xx with ok:true as success (relay won't do this, but the client must be strict).

---

5. Behavior rules

1. Never log the API key or session secret. Redact Authorization to Bearer ***.
2. Never kill a relay you didn't spawn unless the user clicks "Force kill external process" and confirms twice.
3. Fail loud, fail safe. Upstream unreachable → persistent banner; never swallow errors.
4. Idempotent lifecycle. POST /api/relay/start on a running relay returns 200 {ok:true,data:{alreadyRunning:true}}.
5. True streaming. Playground renders the first token before the response completes.
6. Preserve the relay contract. The panel is a client, not a replacement.
7. Deterministic paths. All runtime state under <repo>/data/, created with 0700 on first run.
8. No telemetry. Only the configured relay upstream and any CDN you explicitly document.
9. No secrets in the browser bundle. VITE_* vars must never hold an API key.
10. Toggle truth. After every toggle, the UI state must equal the relay's response data.enabled. If they differ, the relay wins and a warning toast fires.

---

6. Output format

Return the answer as:

1. README.md — setup, env vars, endpoint table (including the /admin/models/* rows and their 200 semantics), screenshots section, troubleshooting.
2. Every source file in a fenced code block preceded by ### path/to/file, in this order:
   package.json → vite.config.ts → tsconfig.json → tsconfig.node.json → tailwind.config.js → postcss.config.js → index.html → .env.example → server/fs-paths.mjs → server/log-bus.mjs → server/metrics.mjs → server/relay-manager.mjs → server/config-store.mjs → server/token-store.mjs → server/auth.mjs → server/rate-limit.mjs → server/routes/*.mjs → server/index.mjs → src/lib/types.ts → src/lib/format.ts → src/lib/sse.ts → src/lib/api.ts → src/lib/hooks/* → every component → every page → src/router.tsx → src/App.tsx → src/main.tsx → src/index.css → Dockerfile → docker-compose.yml → tests.
3. A "How to run" section at the very end with exact shell commands (dev + prod + docker).

Do not truncate files. Do not emit ... placeholders. If a file is long, still emit it in full. Every import must be used. Every route must be reachable. Every component must render with the props you pass it. Prefer clarity over cleverness.