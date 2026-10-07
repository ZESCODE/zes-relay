#!/usr/bin/env python3
"""
pol_relay.py — Pollinations relay with:
  * Tier-aware routing (anonymous / seed / flower key pool)
  * Multi-key support via POL_API_KEYS JSON
  * Model enable/disable toggle (persisted to disk)
  * /v1/config endpoint for the Vite dashboard
  * /v1/models/toggle to flip model availability
  * /v1/models/health with TTL cache
  * Per-tier token-bucket rate limiting
  * Proper chunked streaming (fixes original Content-Length bug)

Environment variables:
  POL_RELAY_PORT    default 7179
  POL_UPSTREAM_BASE default https://gen.pollinations.ai/v1
  POL_SKIP_AUTH     default false — if true, client Authorization header is not required
  POL_API_KEY       legacy single key (used as 'anonymous' key if POL_API_KEYS unset)
  POL_API_KEYS      JSON map: {"anonymous":"none","seed":"sk_xxx","flower":"sk_yyy"}
  POL_STATE_FILE    path to persist disabled-model list (default ./pol_state.json)
  POL_VERBOSE       "true" for verbose upstream logging
"""

import json
import os
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("POL_RELAY_PORT", "7179"))
UPSTREAM = os.environ.get("POL_UPSTREAM_BASE", "https://gen.pollinations.ai/v1").rstrip("/")
SKIP_AUTH = os.environ.get("POL_SKIP_AUTH", "false").lower() == "true"
VERBOSE = os.environ.get("POL_VERBOSE", "false").lower() == "true"
STATE_FILE = os.environ.get(
    "POL_STATE_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "pol_state.json"),
)

# ---- API key pool ---------------------------------------------------------
def _load_api_keys():
    raw = os.environ.get("POL_API_KEYS", "").strip()
    keys = {}
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                keys = {str(k): str(v) for k, v in parsed.items()}
        except Exception as e:
            sys.stderr.write(f"[pol-relay] failed to parse POL_API_KEYS: {e}\n")
    if not keys:
        # Backward compatibility with the old single-key env var.
        legacy = os.environ.get("POL_API_KEY", "none")
        keys = {"anonymous": legacy}
    # Ensure all known tiers have an entry (fall back to "none" = no auth).
    for tier in ("anonymous", "seed", "flower"):
        keys.setdefault(tier, "none")
    return keys

API_KEYS = _load_api_keys()

# ---------------------------------------------------------------------------
# Model -> tier map. Extend this as Pollinations adds new models.
# Anything not in the map is assumed to require "seed" tier.
# ---------------------------------------------------------------------------
MODEL_TIER_MAP = {
    # Anonymous tier
    "openai-fast": "anonymous",
    # Seed tier
    "openai": "seed",
    "openai-large": "seed",
    "openai-audio": "seed",
    "gemini": "seed",
    "gemini-fast": "seed",
    "gemini-large": "seed",
    "gemini-legacy": "seed",
    "gemini-search": "seed",
    "claude": "seed",
    "claude-fast": "seed",
    "claude-large": "seed",
    "claude-legacy": "seed",
    "perplexity-reasoning": "seed",
    "perplexity-fast": "seed",
    "deepseek": "seed",
    "mistral": "seed",
    "grok": "seed",
    "kimi": "seed",
    "qwen-coder": "seed",
    "qwen-safety": "seed",
    "glm": "seed",
    "minimax": "seed",
    "nova-fast": "seed",
    "midijourney": "seed",
    "chickytutor": "seed",
    # Flower tier
    "gptimage": "flower",
}

DEFAULT_TIER = "seed"

def _model_tier(model_name: str) -> str:
    return MODEL_TIER_MAP.get(model_name, DEFAULT_TIER)

def _key_for_tier(tier: str) -> str:
    key = API_KEYS.get(tier)
    if key and key != "none":
        return key
    # Fallback chain: seed -> anonymous -> none
    for fallback in ("seed", "anonymous"):
        k = API_KEYS.get(fallback)
        if k and k != "none":
            return k
    return "none"

# ---------------------------------------------------------------------------
# Persistent state (disabled models)
# ---------------------------------------------------------------------------
_state_lock = threading.Lock()
_state = {"disabled_models": set()}

def _load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        disabled = data.get("disabled_models", [])
        if isinstance(disabled, list):
            _state["disabled_models"] = set(str(m) for m in disabled)
        sys.stderr.write(
            f"[pol-relay] loaded state: {len(_state['disabled_models'])} disabled models\n"
        )
    except FileNotFoundError:
        pass
    except Exception as e:
        sys.stderr.write(f"[pol-relay] state load error: {e}\n")

def _save_state():
    try:
        with _state_lock:
            snapshot = {"disabled_models": sorted(_state["disabled_models"])}
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
        os.replace(tmp, STATE_FILE)
    except Exception as e:
        sys.stderr.write(f"[pol-relay] state save error: {e}\n")

def _is_disabled(model_name: str) -> bool:
    with _state_lock:
        return model_name in _state["disabled_models"]

def _set_disabled(model_name: str, disabled: bool):
    with _state_lock:
        if disabled:
            _state["disabled_models"].add(model_name)
        else:
            _state["disabled_models"].discard(model_name)
    _save_state()

# ---------------------------------------------------------------------------
# Rate limiters (per tier)
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, rate: float, per: float):
        self.rate = rate
        self.per = per
        self.tokens = float(rate)
        self.last = time.time()
        self.lock = threading.Lock()

    def acquire(self):
        with self.lock:
            now = time.time()
            self.tokens = min(
                self.rate,
                self.tokens + (now - self.last) * (self.rate / self.per),
            )
            self.last = now
            if self.tokens < 1:
                wait = (1 - self.tokens) * (self.per / self.rate)
                time.sleep(wait)
                self.tokens = 0
            else:
                self.tokens -= 1

RATE_LIMITERS = {
    "anonymous": RateLimiter(rate=1, per=15.0),
    "seed":      RateLimiter(rate=1, per=5.0),
    "flower":    RateLimiter(rate=1, per=1.0),
}

def _rate_limit(tier: str):
    limiter = RATE_LIMITERS.get(tier)
    if limiter:
        limiter.acquire()

# ---------------------------------------------------------------------------
# Upstream helpers
# ---------------------------------------------------------------------------
def _base_headers():
    return {
        "Content-Type": "application/json",
        "User-Agent": "curl/8.21.0",
        "Accept": "*/*",
    }

def _headers_for_tier(tier: str):
    h = _base_headers()
    key = _key_for_tier(tier)
    if key and key != "none":
        h["Authorization"] = f"Bearer {key}"
    return h

def _fetch_upstream_models(tier: str):
    """Fetch /models using the key for a given tier. Returns parsed JSON or None."""
    key = API_KEYS.get(tier)
    if not key:
        return None
    h = _base_headers()
    if key and key != "none":
        h["Authorization"] = f"Bearer {key}"
    try:
        req = Request(UPSTREAM + "/models", headers=h)
        with urlopen(req, timeout=15) as r:
            raw = r.read()
        return json.loads(raw)
    except HTTPError as e:
        if VERBOSE:
            sys.stderr.write(f"[pol-relay] models ({tier}) HTTP {e.code}\n")
        return None
    except Exception as e:
        if VERBOSE:
            sys.stderr.write(f"[pol-relay] models ({tier}) error: {e}\n")
        return None

def _aggregate_models():
    """
    Query /models with each tier's key and return a merged dict:
        model_id -> {"tier": str, "source_tier": str, "raw": {...}}
    """
    merged = {}
    for tier in ("anonymous", "seed", "flower"):
        data = _fetch_upstream_models(tier)
        if not data:
            continue
        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            mid = item.get("id")
            if not mid:
                continue
            if mid in merged:
                continue
            merged[mid] = {
                "tier": _model_tier(mid),
                "source_tier": tier,
                "raw": item,
            }
    # Ensure every known model appears even if upstream didn't list it.
    for mid, tier in MODEL_TIER_MAP.items():
        if mid not in merged:
            merged[mid] = {
                "tier": tier,
                "source_tier": None,
                "raw": {"id": mid, "object": "model", "owned_by": "pollinations"},
            }
    return merged

# ---------------------------------------------------------------------------
# Health cache
# ---------------------------------------------------------------------------
_health_lock = threading.Lock()
_health_cache = {"ts": 0.0, "data": {}}
HEALTH_TTL = 30.0

def _probe_health(force: bool = False):
    now = time.time()
    with _health_lock:
        if not force and (now - _health_cache["ts"]) < HEALTH_TTL and _health_cache["data"]:
            return _health_cache["data"]

    result = {}
    for tier in ("anonymous", "seed", "flower"):
        data = _fetch_upstream_models(tier)
        if not data:
            continue
        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            mid = item.get("id")
            if not mid:
                continue
            result[mid] = {
                "healthy": True,
                "tier": _model_tier(mid),
                "source_tier": tier,
                "checked_at": now,
            }

    for mid, tier in MODEL_TIER_MAP.items():
        result.setdefault(
            mid,
            {"healthy": False, "tier": tier, "source_tier": None, "checked_at": now},
        )

    with _health_lock:
        _health_cache["ts"] = now
        _health_cache["data"] = result
    return result

# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # ---- logging ---------------------------------------------------------
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[pol-relay] {fmt % args}\n")

    # ---- response helpers ------------------------------------------------
    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        elif body is None:
            body = b""
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            if body:
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    def _stream_upstream(self, upstream, code=200):
        """Relay an upstream streaming response using chunked transfer encoding."""
        ctype = upstream.info().get_content_type() or "text/event-stream"
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            while True:
                chunk = upstream.read(1024)
                if not chunk:
                    break
                self.wfile.write(b"%X\r\n" % len(chunk))
                self.wfile.write(chunk)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ---- CORS ------------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- GET -------------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path in ("/v1/models", "/models"):
            return self._handle_models()
        if path in ("/v1/config", "/config"):
            return self._handle_config()
        if path in ("/v1/models/health", "/models/health"):
            return self._handle_health()
        if path in ("/healthz", "/v1/healthz"):
            return self._send_json(200, {"ok": True, "upstream": UPSTREAM})
        self._send_json(404, {"error": "not found"})

    # ---- POST ------------------------------------------------------------
    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")

        # Client-side auth check
        client_auth = self.headers.get("Authorization")
        if not SKIP_AUTH and not client_auth:
            return self._send_json(
                401, {"error": {"message": "Missing Authorization Header"}}
            )

        if path in ("/v1/models/toggle", "/models/toggle"):
            return self._handle_toggle()
        if path.endswith("/chat/completions"):
            return self._handle_chat(client_auth)
        self._send_json(404, {"error": "not found"})

    # ---- /v1/models ------------------------------------------------------
    def _handle_models(self):
        try:
            merged = _aggregate_models()
        except Exception as e:
            return self._send_json(502, {"error": str(e)})

        data = []
        for mid, meta in merged.items():
            if _is_disabled(mid):
                continue
            item = dict(meta["raw"])
            item["tier"] = meta["tier"]
            data.append(item)

        self._send_json(
            200,
            {
                "object": "list",
                "data": data,
                "relay": {
                    "upstream": UPSTREAM,
                    "tiers_available": [
                        t for t, k in API_KEYS.items() if k and k != "none"
                    ],
                },
            },
        )

    # ---- /v1/config ------------------------------------------------------
    def _handle_config(self):
        try:
            merged = _aggregate_models()
            health = _probe_health()
        except Exception as e:
            return self._send_json(502, {"error": str(e)})

        models = []
        for mid, meta in merged.items():
            h = health.get(mid, {})
            models.append(
                {
                    "id": mid,
                    "object": "model",
                    "owned_by": meta["raw"].get("owned_by", "pollinations"),
                    "tier": meta["tier"],
                    "source_tier": meta["source_tier"],
                    "enabled": not _is_disabled(mid),
                    "healthy": bool(h.get("healthy", False)),
                    "available": (
                        meta["source_tier"] is not None
                        and API_KEYS.get(meta["tier"], "none") != "none"
                    ),
                }
            )

        models.sort(key=lambda m: (m["tier"], m["id"]))

        self._send_json(
            200,
            {
                "upstream": UPSTREAM,
                "skip_auth": SKIP_AUTH,
                "tiers_available": [
                    t for t, k in API_KEYS.items() if k and k != "none"
                ],
                "rate_limits": {
                    "anonymous": "1/15s",
                    "seed": "1/5s",
                    "flower": "1/1s",
                },
                "total": len(models),
                "enabled_count": sum(1 for m in models if m["enabled"]),
                "models": models,
            },
        )

    # ---- /v1/models/health ----------------------------------------------
    def _handle_health(self):
        force = "refresh=1" in self.path or "force=1" in self.path
        try:
            health = _probe_health(force=force)
        except Exception as e:
            return self._send_json(502, {"error": str(e)})
        self._send_json(
            200,
            {
                "checked_at": health and next(iter(health.values()))["checked_at"],
                "ttl": HEALTH_TTL,
                "models": health,
            },
        )

    # ---- /v1/models/toggle ----------------------------------------------
    def _handle_toggle(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0:
            return self._send_json(400, {"error": "empty body"})

        try:
            raw = self.rfile.read(length)
            payload = json.loads(raw)
        except Exception:
            return self._send_json(400, {"error": "invalid json"})

        model_name = payload.get("model") or payload.get("id")
        if not isinstance(model_name, str) or not model_name:
            return self._send_json(400, {"error": "missing 'model'"})

        if "enabled" in payload:
            enabled = bool(payload["enabled"])
        elif "disabled" in payload:
            enabled = not bool(payload["disabled"])
        else:
            # Toggle
            enabled = _is_disabled(model_name)

        _set_disabled(model_name, disabled=not enabled)
        sys.stderr.write(
            f"[pol-relay] model '{model_name}' {'enabled' if enabled else 'disabled'}\n"
        )
        self._send_json(
            200,
            {
                "model": model_name,
                "enabled": enabled,
                "tier": _model_tier(model_name),
            },
        )

    # ---- /v1/chat/completions -------------------------------------------
    def _handle_chat(self, client_auth):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0:
            return self._send_json(400, {"error": "empty body"})

        try:
            raw = self.rfile.read(length)
            params = json.loads(raw)
        except Exception:
            return self._send_json(400, {"error": "invalid json"})

        model_name = params.get("model") or "openai-fast"
        if _is_disabled(model_name):
            return self._send_json(
                403,
                {
                    "error": {
                        "message": f"Model '{model_name}' disabled by administrator",
                        "type": "model_disabled",
                        "code": "model_disabled",
                    }
                },
            )

        tier = _model_tier(model_name)

        # Enforce rate limit for the tier we're about to use.
        try:
            _rate_limit(tier)
        except Exception:
            pass

        stream = bool(params.get("stream", False))

        # Build upstream headers.
        headers = _base_headers()
        if client_auth:
            headers["Authorization"] = client_auth
        else:
            key = _key_for_tier(tier)
            if key and key != "none":
                headers["Authorization"] = f"Bearer {key}"

        data = json.dumps(params).encode("utf-8")
        req = Request(
            UPSTREAM + "/chat/completions",
            data=data,
            headers=headers,
            method="POST",
        )

        try:
            upstream = urlopen(req, timeout=600)
        except HTTPError as e:
            err_body = e.read().decode(errors="replace")[:1000]
            sys.stderr.write(
                f"[pol-relay] upstream {e.code} for '{model_name}': {err_body[:200]}\n"
            )
            return self._send(
                e.code,
                json.dumps({"error": err_body}),
                "application/json",
            )
        except URLError as e:
            return self._send_json(
                502, {"error": {"message": f"upstream unreachable: {e.reason}"}}
            )
        except Exception as e:
            return self._send_json(502, {"error": {"message": str(e)}})

        ctype = upstream.info().get_content_type()

        if stream:
            return self._stream_upstream(upstream, 200)

        # Non-streaming: read fully, strip SSE [DONE] if upstream misbehaves.
        try:
            body = upstream.read()
        except Exception as e:
            return self._send_json(502, {"error": {"message": str(e)}})

        if "event-stream" in ctype or body.lstrip().startswith(b"data:"):
            body = b"".join(
                line
                for line in body.split(b"\n")
                if line.strip() != b"data: [DONE]"
            )

        self._send(200, body, ctype)

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    import socketserver

    _load_state()

    socketserver.ThreadingTCPServer.request_queue_size = 128
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    tiers = [t for t, k in API_KEYS.items() if k and k != "none"]
    sys.stderr.write(
        f"[pol-relay] listening on 127.0.0.1:{PORT} -> {UPSTREAM}\n"
        f"[pol-relay] tiers with keys: {tiers or ['(none)']}\n"
        f"[pol-relay] SKIP_AUTH={SKIP_AUTH}  STATE_FILE={STATE_FILE}\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[pol-relay] shutting down\n")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()