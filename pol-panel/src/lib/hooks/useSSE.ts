import { useEffect, useRef, useState } from "react";
import { openSSE, type SSEHandle } from "../sse";

export interface UseSSEOptions {
  /** Set false for one-shot streams (e.g. a test run) that must not self-restart. */
  reconnect?: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface UseSSEResult {
  connected: boolean;
  error: string | null;
  retries: number;
}

/**
 * Subscribe to an SSE endpoint for as long as `url` is non-null.
 * Reconnects with exponential backoff and suspends while the tab is hidden.
 */
export function useSSE<T = unknown>(
  url: string | null,
  onMessage: (event: string, data: T) => void,
  options: UseSSEOptions = {},
): UseSSEResult {
  const { reconnect = true, maxRetries = 6, baseDelayMs = 1000 } = options;
  const handlerRef = useRef(onMessage);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url) {
      setConnected(false);
      return;
    }

    let handle: SSEHandle | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      handle = openSSE<T>(url, {
        onOpen: () => {
          attempts = 0;
          setRetries(0);
          setError(null);
          setConnected(true);
        },
        onMessage: (event, data) => handlerRef.current(event, data),
        onError: (err) => {
          setConnected(false);
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          if (!reconnect || attempts >= maxRetries) return;
          attempts += 1;
          setRetries(attempts);
          const delay = Math.min(15000, baseDelayMs * 2 ** (attempts - 1));
          retryTimer = setTimeout(connect, delay);
        },
        onDone: () => {
          setConnected(false);
          if (!reconnect || stopped) return;
          attempts += 1;
          if (attempts > maxRetries) return;
          retryTimer = setTimeout(connect, Math.min(15000, baseDelayMs * 2 ** (attempts - 1)));
        },
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        handle?.close();
        handle = null;
        setConnected(false);
      } else if (!handle) {
        attempts = 0;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      handle?.close();
      setConnected(false);
    };
  }, [url, reconnect, maxRetries, baseDelayMs]);

  return { connected, error, retries };
}
