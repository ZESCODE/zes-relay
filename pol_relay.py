#!/usr/bin/env python3
import json
import os
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

PORT = int(os.environ.get("POL_RELAY_PORT", "7179"))
UPSTREAM = os.environ.get("POL_UPSTREAM_BASE", "https://gen.pollinations.ai/v1")
API_KEY = os.environ.get("POL_API_KEY", "none")
SKIP_AUTH = os.environ.get("POL_SKIP_AUTH", "false").lower() == "true"

def _headers():
    h = {"Content-Type": "application/json", "User-Agent": "curl/8.21.0", "Accept": "*/*"}
    if API_KEY and not SKIP_AUTH:
        h["Authorization"] = f"Bearer {API_KEY}"
    return h

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[pol-relay] {fmt % args}\n")

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models" or self.path.rstrip("/") == "/models":
            try:
                req = Request(UPSTREAM + "/models", headers=_headers())
                with urlopen(req, timeout=10) as r:
                    raw = r.read()
                    ctype = r.info().get_content_type()
                    if "event-stream" in ctype or (raw.lstrip().startswith(b"data:")):
                        raw = b"".join(line for line in raw.split(b"\n") if not line.strip() == b"data: [DONE]")
                    self._send(200, raw, ctype)
                    return
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}))
                return
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        # Check client authentication if required
        if not SKIP_AUTH:
            auth = self.headers.get("Authorization")
            if not auth:
                self._send(401, json.dumps({"error": {"message": "Missing Authorization Header"}}))
                return

        # Only handle chat/completions endpoints
        if not (self.path.rstrip("/").endswith("/v1/chat/completions") or
                self.path.rstrip("/").endswith("/chat/completions")):
            self._send(404, json.dumps({"error": "not found"}))
            return

        content_len = int(self.headers.get("Content-Length", 0))
        if content_len == 0:
            self._send(400, json.dumps({"error": "empty body"}))
            return

        try:
            body = self.rfile.read(content_len)
            params = json.loads(body)
        except Exception:
            self._send(400, json.dumps({"error": "invalid json"}))
            return

        stream = bool(params.get("stream", False))

        # Prepare headers for upstream request
        headers = _headers()
        # Forward client's Authorization header if present (overrides any from _headers)
        client_auth = self.headers.get("Authorization")
        if client_auth:
            headers["Authorization"] = client_auth

        # Prepare request data
        data = json.dumps(params).encode("utf-8")
        # Make request to upstream
        req = Request(UPSTREAM + "/chat/completions", data=data, headers=headers, method="POST")
        try:
            upstream = urlopen(req, timeout=600)
            ctype = upstream.info().get_content_type()
            if stream:
                # Stream response as-is
                self._send(200, "", ctype)
                self.wfile.write(upstream.read())
            else:
                raw = upstream.read()
                # If SSE-like, strip [DONE] trailing lines
                if "event-stream" in ctype or (raw.lstrip().startswith(b"data:")):
                    raw = b"".join(line for line in raw.split(b"\n") if not line.strip() == b"data: [DONE]")
                self._send(200, raw, ctype)
        except HTTPError as e:
            err_body = e.read().decode(errors="replace")[:500]
            print(f"[pol-relay] upstream error {e.code}: {err_body[:200]}", flush=True)
            self._send(e.code, json.dumps({"error": err_body}), "application/json")
        except Exception as e:
            self._send(502, json.dumps({"error": {"message": str(e)}}), "application/json")

if __name__ == "__main__":
    import socketserver
    socketserver.ThreadingTCPServer.request_queue_size = 128
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[pol-relay] listening on 127.0.0.1:{PORT} -> {UPSTREAM}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass