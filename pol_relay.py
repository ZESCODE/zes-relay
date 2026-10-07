#!/usr/bin/env python3
"""
pol_relay.py — OpenAI-compatible relay for Pollinations with model controls.

Env:
  POL_RELAY_PORT         (default 7179)
  POL_UPSTREAM_BASE      (default https://gen.pollinations.ai/v1)
  POL_API_KEY            (default "none")
  POL_SKIP_AUTH          (default false) — skip client auth and forward caller's header
  POL_DATA_DIR           (default ./data) — where models.json lives
  POL_MODEL_CACHE_TTL    (default 60s)   — /v1/models cache
  POL_UPSTREAM_TIMEOUT   (default 600s)  — chat completions timeout
"""
import json
import os
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("POL_RELAY_PORT", "7179"))
UPSTREAM = os.environ.get("POL_UPSTREAM_BASE", "https://gen.pollinations.ai/v1").rstrip("/")
API_KEY = os.environ.get("POL_API_KEY", "none")
SKIP_AUTH = os.environ.get("POL_SKIP_AUTH", "false").lower() == "true"
DATA_DIR = os.environ.get(
    "POL_DATA_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
)
MODELS_FILE = os.path.join(DATA_DIR, "models.json")
MODEL_CACHE_TTL = int(os.environ.get("POL_MODEL_CACHE_TTL", "60"))
UPSTREAM_TIMEOUT = int(os.environ.get("POL_UPSTREAM_TIMEOUT", "600"))

os.makedirs(DATA_DIR, exist_ok=True)

_START_TS = time.time()
_state_lock = threading.RLock()
_state = {
    "disabled": set(),      # model ids the operator turned off
    "cache": [],            # last good upstream model list
    "cache_ts": 0.0,
    "test_results": {},     # id -> {ok, status, latency_ms, ts, error}
}


# ── state persistence ────────────────────────────────────────────────────────
def _load_state():
    if not os.path.isfile(MODELS_FILE):
        return
    try:
        with open(MODELS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        disabled = data.get("disabled", [])
        if isinstance(disabled, list):
            _state["disabled"] = {str(x) for x in disabled}
    except Exception as e:
        sys.stderr.write(f"[pol-relay] models.json load failed: {e}\n")


def _save_state():
    with _state_lock:
        payload = {
            "disabled": sorted(_state["disabled"]),
            "updated_at": time.time(),
        }
    tmp = MODELS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp, MODELS_FILE)


_load_state()


# ── helpers ──────────────────────────────────────────────────────────────────
def _headers():
    h = {
        "Content-Type": "application/json",
        "User-Agent": "curl/8.21.0",
        "Accept": "*/*",
    }
    if API_KEY and not SKIP_AUTH:
        h["Authorization"] = f"Bearer {API_KEY}"
    return h


def _ok(data):
    return {"ok": True, "data": data}


def _err(code, message):
    return {"ok": False, "error": {"code": code, "message": str(message)}}


def _model_id(m):
    if isinstance(m, dict):
        return m.get("id") or m.get("name") or ""
    return str(m)


def _fetch_models(force=False):
    now = time.time()
    with _state_lock:
        if not force and _state["cache"] and (now - _state["cache_ts"]) < MODEL_CACHE_TTL:
            return list(_state["cache"])
    try:
        req = Request(UPSTREAM + "/models", headers=_headers())
        with urlopen(req, timeout=15) as r:
            raw = r.read()
            ctype = r.info().get_content_type()
            if "event-stream" in ctype or raw.lstrip().startswith(b"data:"):
                # Some Pollinations deployments stream SSE for /models.
                pieces = []
                for line in raw.split(b"\n"):
                    line = line.strip()
                    if line.startswith(b"data:"):
                        payload = line[5:].strip()
                        if payload and payload != b"[DONE]":
                            pieces.append(payload)
                raw = b"".join(pieces) or b"{}"
            parsed = json.loads(raw)
            models = parsed.get("data") if isinstance(parsed, dict) else parsed
            if not isinstance(models, list):
                models = []
    except Exception as e:
        sys.stderr.write(f"[pol-relay] upstream /models failed: {e}\n")
        with _state_lock:
            return list(_state["cache"])
    with _state_lock:
        _state["cache"] = models
        _state["cache_ts"] = now
    return models


def _annotate(models):
    with _state_lock:
        disabled = set(_state["disabled"])
        tests = dict(_state["test_results"])
    out = []
    for m in models:
        mid = _model_id(m)
        if not mid:
            continue
        entry = dict(m) if isinstance(m, dict) else {"id": mid}
        entry["enabled"] = mid not in disabled
        entry["available"] = mid not in disabled
        if mid in tests:
            entry["last_test"] = tests[mid]
        out.append(entry)
    return out


def _is_model_enabled(model_id):
    with _state_lock:
        return model_id not in _state["disabled"]


def _test_model(model_id, timeout=30):
    body = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "stream": False,
    }).encode("utf-8")
    req = Request(UPSTREAM + "/chat/completions", data=body,
                  headers=_headers(), method="POST")
    t0 = time.time()
    try:
        with urlopen(req, timeout=timeout) as r:
            status = r.status
            raw = r.read(4096)
            ctype = r.info().get_content_type()
            if "event-stream" in ctype or raw.lstrip().startswith(b"data:"):
                ok = b"data:" in raw
            else:
                ok = 200 <= status < 300
        result = {
            "ok": ok,
            "status": status,
            "latency_ms": int((time.time() - t0) * 1000),
            "ts": time.time(),
        }
    except HTTPError as e:
        msg = ""
        try:
            msg = e.read().decode(errors="replace")[:200]
        except Exception:
            pass
        result = {
            "ok": False,
            "status": e.code,
            "latency_ms": int((time.time() - t0) * 1000),
            "ts": time.time(),
            "error": msg,
        }
    except Exception as e:
        result = {
            "ok": False,
            "status": 0,
            "latency_ms": int((time.time() - t0) * 1000),
            "ts": time.time(),
            "error": str(e)[:200],
        }
    with _state_lock:
        _state["test_results"][model_id] = result
    return result


# ── handler ──────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "pol-relay/2.0"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[pol-relay] {fmt % args}\n")

    # ---- low level ----
    def _send(self, code, body, ctype="application/json", extra_headers=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Pol-Relay", "1")
            if extra_headers:
                for k, v in extra_headers.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, code, payload):
        self._send(code, json.dumps(payload).encode("utf-8"), "application/json")

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
        except ValueError:
            return None
        if n <= 0:
            return None
        try:
            return json.loads(self.rfile.read(n))
        except Exception:
            return None

    def _path(self):
        p = urlparse(self.path)
        return (p.path.rstrip("/") or "/"), parse_qs(p.query)

    # ---- CORS ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    # ---- GET ----
    def do_GET(self):
        path, query = self._path()

        if path in ("/health", "/healthz"):
            with _state_lock:
                disabled_n = len(_state["disabled"])
                cached_n = len(_state["cache"])
            self._send_json(200, _ok({
                "status": "ok",
                "uptime_s": int(time.time() - _START_TS),
                "upstream": UPSTREAM,
                "disabled_models": disabled_n,
                "cached_models": cached_n,
            }))
            return

        if path in ("/v1/models", "/models"):
            all_models = _fetch_models(force="refresh" in query)
            annotated = _annotate(all_models)
            include_disabled = query.get("all", ["false"])[0].lower() == "true"
            if not include_disabled:
                annotated = [m for m in annotated if m.get("enabled", True)]
            self._send_json(200, {"object": "list", "data": annotated})
            return

        if path == "/admin/models":
            all_models = _fetch_models(force="refresh" in query)
            self._send_json(200, _ok(_annotate(all_models)))
            return

        if path == "/admin/models/disabled":
            with _state_lock:
                disabled = sorted(_state["disabled"])
                tests = dict(_state["test_results"])
            self._send_json(200, _ok({"disabled": disabled, "tests": tests}))
            return

        self._send_json(404, _err("not_found", "not found"))

    # ---- POST ----
    def do_POST(self):
        path, _ = self._path()

        if path.startswith("/admin/"):
            if not SKIP_AUTH and not self.headers.get("Authorization"):
                self._send_json(401, _err("unauthorized", "Missing Authorization Header"))
                return
            self._handle_admin(path)
            return

        if path.endswith("/v1/chat/completions") or path.endswith("/chat/completions"):
            if not SKIP_AUTH and not self.headers.get("Authorization"):
                self._send_json(401, _err("unauthorized", "Missing Authorization Header"))
                return
            self._handle_chat()
            return

        self._send_json(404, _err("not_found", "not found"))

    # ---- admin ----
    def _handle_admin(self, path):
        params = self._read_json() or {}

        if path in ("/admin/models/enable", "/admin/models/disable", "/admin/models/toggle"):
            mid = params.get("id")
            if not mid:
                self._send_json(400, _err("bad_request", "missing 'id'"))
                return
            with _state_lock:
                if path.endswith("/enable"):
                    _state["disabled"].discard(mid)
                    enabled = True
                elif path.endswith("/disable"):
                    _state["disabled"].add(mid)
                    enabled = False
                else:  # toggle
                    if mid in _state["disabled"]:
                        _state["disabled"].discard(mid)
                        enabled = True
                    else:
                        _state["disabled"].add(mid)
                        enabled = False
                _save_state()
            self._send_json(200, _ok({"id": mid, "enabled": enabled}))
            return

        if path == "/admin/models/test":
            mid = params.get("id")
            if not mid:
                self._send_json(400, _err("bad_request", "missing 'id'"))
                return
            result = _test_model(mid)
            self._send_json(200, _ok({"id": mid, **result}))
            return

        if path == "/admin/models/test-all":
            all_models = _fetch_models()
            ids = [m.get("id") for m in all_models
                   if isinstance(m, dict) and m.get("id")]
            results = {mid: _test_model(mid) for mid in ids}
            self._send_json(200, _ok({"tested": len(ids), "results": results}))
            return

        if path == "/admin/models/reset":
            with _state_lock:
                _state["disabled"].clear()
                _save_state()
            self._send_json(200, _ok({"disabled": []}))
            return

        self._send_json(404, _err("not_found", "unknown admin endpoint"))

    # ---- chat ----
    def _handle_chat(self):
        params = self._read_json()
        if params is None:
            self._send_json(400, _err("bad_request", "invalid or empty json"))
            return

        model_id = params.get("model")
        if model_id and not _is_model_enabled(model_id):
            self._send_json(403, _err("model_disabled",
                                      f"model '{model_id}' is disabled"))
            return

        headers = _headers()
        client_auth = self.headers.get("Authorization")
        if client_auth:
            headers["Authorization"] = client_auth

        stream = bool(params.get("stream", False))
        data = json.dumps(params).encode("utf-8")
        req = Request(UPSTREAM + "/chat/completions", data=data,
                      headers=headers, method="POST")

        try:
            upstream = urlopen(req, timeout=UPSTREAM_TIMEOUT)
            ctype = upstream.info().get_content_type()

            if stream:
                self.send_response(200)
                self.send_header("Content-Type", ctype or "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "close")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("X-Pol-Relay", "1")
                self.end_headers()
                try:
                    while True:
                        chunk = upstream.read(4096)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    self.wfile.write(b"\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
                return

            raw = upstream.read()
            if "event-stream" in ctype or raw.lstrip().startswith(b"data:"):
                raw = b"\n".join(
                    line for line in raw.split(b"\n")
                    if line.strip() != b"data: [DONE]"
                )
            self._send(200, raw, ctype or "application/json")

        except HTTPError as e:
            try:
                body = e.read()[:500]
            except Exception:
                body = b""
            try:
                parsed = json.loads(body)
                msg = (parsed.get("error") if isinstance(parsed, dict) else None) or body.decode(errors="replace")
            except Exception:
                msg = body.decode(errors="replace") or e.reason
            sys.stderr.write(f"[pol-relay] upstream error {e.code}: {str(msg)[:200]}\n")
            self._send_json(e.code, _err("upstream_error", msg))
        except (URLError, TimeoutError) as e:
            self._send_json(502, _err("upstream_unreachable", str(e)))
        except Exception as e:
            self._send_json(500, _err("internal", str(e)))


if __name__ == "__main__":
    import socketserver
    socketserver.ThreadingTCPServer.request_queue_size = 128
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[pol-relay] listening on 127.0.0.1:{PORT} -> {UPSTREAM}", flush=True)
    print(f"[pol-relay] data dir: {DATA_DIR}", flush=True)
    print(f"[pol-relay] skip_auth: {SKIP_AUTH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass