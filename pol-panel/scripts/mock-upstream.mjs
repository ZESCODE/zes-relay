#!/usr/bin/env node
/**
 * scripts/mock-upstream.mjs — a tiny OpenAI-compatible upstream for offline work.
 *
 * Point the relay at it when you have no network (Termux on a train, CI, a
 * demo) and still want the panel populated:
 *
 *   node scripts/mock-upstream.mjs            # listens on 127.0.0.1:7290
 *   POL_UPSTREAM_BASE=http://127.0.0.1:7290/v1 npm start
 *
 * Two models are deliberately broken so the "Failing" filter and the error
 * tiles have something to show.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 7290);
const HOST = process.env.MOCK_HOST || "127.0.0.1";

const MODELS = [
  { id: "openai", owned_by: "openai" },
  { id: "openai-large", owned_by: "openai" },
  { id: "mistral", owned_by: "mistral" },
  { id: "llama", owned_by: "meta" },
  { id: "deepseek", owned_by: "deepseek" },
  { id: "qwen-coder", owned_by: "qwen" },
  { id: "searchgpt", owned_by: "openai" },
  { id: "broken-model", owned_by: "mock" },
  { id: "slow-model", owned_by: "mock" },
];

const BROKEN = new Set(["broken-model"]);
const SLOW = new Set(["slow-model"]);

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
      json(res, 200, {
        object: "list",
        data: MODELS.map((model, index) => ({
          id: model.id,
          object: "model",
          created: 1_700_000_000 + index,
          owned_by: model.owned_by,
        })),
      });
      return;
    }

    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { ok: false, error: { code: "bad_json", message: "invalid json" } });
        return;
      }
      const model = String(body.model || "mock");

      if (BROKEN.has(model)) {
        json(res, 500, { error: { message: `mock upstream: ${model} is broken`, type: "server_error" } });
        return;
      }
      const delay = SLOW.has(model) ? 1500 : 60;
      const reply = `mock reply from ${model}: ${String(body.messages?.at(-1)?.content ?? "").slice(0, 60)}`;

      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        const words = reply.split(" ");
        for (const [index, word] of words.entries()) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          const chunk = {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: { content: `${word}${index === words.length - 1 ? "" : " "}` }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length },
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      json(res, 200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: reply.split(" ").length, total_tokens: 12 + reply.split(" ").length },
      });
      return;
    }

    json(res, 404, { ok: false, error: { code: "not_found", message: `mock has no ${req.method} ${url.pathname}` } });
  });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(`[mock-upstream] listening on http://${HOST}:${PORT}/v1 (${MODELS.length} models)\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
