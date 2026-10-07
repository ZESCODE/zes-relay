/**
 * sse.ts — hand-rolled Server-Sent-Events transport.
 *
 * EventSource cannot POST and cannot send custom headers, so every stream in
 * the panel (logs, metrics, model tests) is read with fetch + ReadableStream.
 * The parser below implements the subset of the SSE spec we use:
 * `event:` / `data:` / `id:` fields, `:` comments, blank-line dispatch.
 */

export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Feed one chunk of text, get back any complete messages plus the leftover
 * buffer that must be prepended to the next chunk.
 */
export function parseSSEChunk(buffer: string): { messages: SSEMessage[]; rest: string } {
  const messages: SSEMessage[] = [];
  // Normalise CRLF so splitting on \n is enough.
  const text = buffer.replace(/\r\n/g, "\n");
  const blocks = text.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const rawLine of block.split("\n")) {
      if (!rawLine || rawLine.startsWith(":")) continue;
      const colon = rawLine.indexOf(":");
      const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
      let value = colon === -1 ? "" : rawLine.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
      else if (field === "id") id = value;
    }
    if (dataLines.length === 0) continue;
    messages.push({ event, data: dataLines.join("\n"), ...(id ? { id } : {}) });
  }
  return { messages, rest };
}

/** Async-iterate the SSE messages of a streaming fetch Response. */
export async function* iterSSE(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SSEMessage, void, unknown> {
  if (!response.body) throw new Error("response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { messages, rest } = parseSSEChunk(buffer);
      buffer = rest;
      for (const message of messages) yield message;
    }
    if (buffer.trim()) {
      const { messages } = parseSSEChunk(`${buffer}\n\n`);
      for (const message of messages) yield message;
    }
  } finally {
    reader.releaseLock();
  }
}

export function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface SSEHandlers<T = unknown> {
  onMessage: (event: string, data: T) => void;
  onError?: (error: unknown) => void;
  onOpen?: () => void;
  onDone?: () => void;
}

export interface SSEHandle {
  close: () => void;
  readonly closed: boolean;
}

/**
 * Open a GET SSE stream. Reconnection/backoff is the caller's job (see
 * useSSE) so a cancelled test run does not silently resurrect itself.
 */
export function openSSE<T = unknown>(url: string, handlers: SSEHandlers<T>): SSEHandle {
  const controller = new AbortController();
  let closed = false;

  (async () => {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`SSE ${url} failed: HTTP ${response.status}`);
      handlers.onOpen?.();
      for await (const message of iterSSE(response, controller.signal)) {
        if (closed) return;
        handlers.onMessage(message.event, safeJson<T>(message.data) ?? (message.data as unknown as T));
      }
      if (!closed) handlers.onDone?.();
    } catch (error) {
      if (closed || (error as Error)?.name === "AbortError") return;
      handlers.onError?.(error);
    }
  })();

  return {
    close() {
      closed = true;
      controller.abort();
    },
    get closed() {
      return closed;
    },
  };
}
