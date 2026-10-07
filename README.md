# zes-relay

`pol_relay.py` is a small, dependency-free OpenAI-compatible relay for Pollinations with
**per-model activation controls**:

* proxies `POST /v1/chat/completions` (streaming and non-streaming) and `GET /v1/models`
* keeps a persistent disabled-model set in `data/models.json`
* filters `/v1/models` to enabled models (`?all=true` includes disabled ones)
* exposes `/admin/models/*` for enable / disable / toggle / test / test-all / reset
* rejects chat for a disabled model with `403 model_disabled`
* answers `{ok:true,data}` / `{ok:false,error:{code,message}}`, logs to stderr as `[pol-relay]`

```bash
python3 pol_relay.py            # 127.0.0.1:7179 → https://gen.pollinations.ai/v1
./pol-relay.sh                  # same, with POL_SKIP_AUTH=true
```

## pol-panel — the control panel

[`pol-panel/`](pol-panel/README.md) is a Vite + React 18 + TypeScript dashboard for the relay,
with a Node/Express sidecar as its only backend. It is built **mobile-first for Android/Termux**
(bottom tab bar, 44 px tap targets, no native npm modules, no canvas) and its headline feature is
**per-model toggles plus one-click "test all models"**.

```bash
cd pol-panel
npm install
npm run dev            # http://127.0.0.1:7177  (dev, hot reload)
# or
npm run build && npm start   # http://127.0.0.1:7178 (production, one port)
```

Termux:

```bash
bash pol-panel/termux-setup.sh
bash pol-panel/termux-start.sh
```

Models · Playground · Logs · Config · Admin, live metrics, streaming chat, log tailing, API
tokens, ZIP backups — see **[pol-panel/README.md](pol-panel/README.md)** for the full endpoint
table, every environment variable and the troubleshooting guide.

## Layout

```
pol_relay.py          the relay (stdlib only, Python 3.9+)
pol-relay.sh          convenience launcher (POL_SKIP_AUTH=true)
pol-panel/            Vite + React dashboard + Node sidecar
BUILD-PROMPT.md       the specification the panel was built from
```

## License

MIT — see [LICENSE](LICENSE).
