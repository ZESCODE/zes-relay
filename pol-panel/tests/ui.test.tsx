// @vitest-environment jsdom
/**
 * tests/ui.test.tsx — mounts the real React app against a real sidecar + relay
 * and drives it with clicks. This is the check that the dashboard is not just
 * type-correct but actually renders and talks to the API.
 *
 * Stacks in one process: mock upstream → pol_relay.py → Express sidecar → jsdom.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";

/** Re-rendering <MemoryRouter initialEntries> does NOT navigate; drive it. */
function NavigateTo({ path }: { path: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(path);
  }, [navigate, path]);
  return null;
}

if (!globalThis.TextDecoder) {
  // @ts-expect-error — jsdom does not ship TextDecoder, Node does.
  globalThis.TextDecoder = NodeTextDecoder;
}
if (!globalThis.TextEncoder) {
  // @ts-expect-error — same for TextEncoder.
  globalThis.TextEncoder = NodeTextEncoder;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pol-panel-ui-"));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

const relayPort = await freePort();
const mockPort = await freePort();

const MODELS = [
  { id: "openai", owned_by: "openai" },
  { id: "mistral", owned_by: "mistral" },
  { id: "llama", owned_by: "meta" },
];

const mockUpstream = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: MODELS }));
      return;
    }
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-ui",
          object: "chat.completion",
          model: "mock",
          choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
});

process.env.POL_DATA_DIR = TMP;
process.env.POL_RELAY_PORT = String(relayPort);
process.env.POL_UPSTREAM_BASE = `http://127.0.0.1:${mockPort}/v1`;
process.env.POL_SKIP_AUTH = "true";
process.env.PANEL_ADMIN_USER = "admin";
process.env.PANEL_ADMIN_PASSWORD = "ui-test-password";
process.env.PANEL_AUTOSTART = "false";
process.env.PANEL_ACCESS_LOG = "false";

const { createPanel } = await import("../server/index.mjs");
const { sessionStore } = await import("../src/lib/hooks/useSession");
const App = (await import("../src/App")).default;

let panel: Awaited<ReturnType<typeof createPanel>>;
let server: http.Server;
let base = "";
let cookieHeader = "";
const realFetch = globalThis.fetch;

/** Route every relative /api call at the test sidecar with our session cookie. */
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input).startsWith("http")
    ? String(input)
    : `${base}${String(input)}`;
  return realFetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), cookie: cookieHeader },
  });
}) as typeof fetch;

async function waitFor(check: () => void | boolean, timeoutMs = 15000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = check();
      if (result !== false) return;
    } catch (error) {
      lastError = error;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }
  throw new Error(`timed out waiting for ${label}: ${lastError instanceof Error ? lastError.message : ""}`);
}

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await new Promise((resolve) => mockUpstream.listen(mockPort, "127.0.0.1", resolve));

  panel = createPanel();
  server = panel.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  await panel.relay.start();

  const login = await realFetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "ui-test-password" }),
  });
  const body = (await login.json()) as { data: { csrf: string } };
  cookieHeader = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
  // The browser would set this from Set-Cookie; jsdom + node fetch do not.
  document.cookie = `pp_csrf=${body.data.csrf}; path=/`;
  await sessionStore.load(true);
});

afterAll(async () => {
  await act(async () => {
    root?.unmount();
  });
  panel?.relay.stopHealthLoop();
  await panel?.relay.shutdown();
  // SSE connections keep server.close() pending; drop them explicitly.
  (server as unknown as { closeAllConnections?: () => void })?.closeAllConnections?.();
  await new Promise((resolve) => server?.close(resolve));
  await new Promise((resolve) => mockUpstream.close(resolve));
});

describe("panel UI", () => {
  it("renders the Models page with one switch per model", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/models"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </MemoryRouter>,
      );
    });

    await waitFor(
      () => {
        const switches = container.querySelectorAll('[role="switch"]');
        expect(switches.length).toBe(MODELS.length);
      },
      20000,
      "model switches to render",
    );

    for (const model of MODELS) {
      expect(container.textContent).toContain(model.id);
    }
    // Bottom tab bar for phones + the sidebar for desktop both exist in the DOM.
    expect(container.querySelectorAll('nav[aria-label="Main"]').length).toBe(2);
  });

  it("flips a model off through the switch and reconciles to the relay", async () => {
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
    const mistral = switches.find((element) => element.getAttribute("aria-label")?.includes("mistral"));
    expect(mistral).toBeTruthy();
    expect(mistral!.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      mistral!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(
      () => {
        const current = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find(
          (element) => element.getAttribute("aria-label")?.includes("mistral"),
        );
        expect(current?.getAttribute("aria-checked")).toBe("false");
      },
      15000,
      "switch to settle on disabled",
    );

    // The relay is the source of truth: confirm it really persisted.
    const check = await realFetch(`${base}/api/models`, { headers: { cookie: cookieHeader } });
    const payload = (await check.json()) as { data: { models: Array<{ id: string; enabled: boolean }> } };
    expect(payload.data.models.find((model) => model.id === "mistral")?.enabled).toBe(false);

    // Flip it back so the relay state is clean for the next test.
    // (The store ignores repeat toggles of the same model within 300 ms.)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    const restore = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find(
      (element) => element.getAttribute("aria-label")?.includes("mistral"),
    );
    await act(async () => {
      restore!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await waitFor(() => {
      const current = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')).find(
        (element) => element.getAttribute("aria-label")?.includes("mistral"),
      );
      expect(current?.getAttribute("aria-checked")).toBe("true");
    }, 15000, "switch to settle on enabled");
  });

  it("renders the dashboard tiles from the live metrics stream", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/models"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <NavigateTo path="/" />
          <App />
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    await waitFor(
      () => {
        expect(container.textContent).toContain("Dashboard");
        expect(container.textContent).toContain("p95 latency");
        expect(container.textContent).toContain("Requests");
      },
      20000,
      "dashboard tiles",
    );
  });
});
