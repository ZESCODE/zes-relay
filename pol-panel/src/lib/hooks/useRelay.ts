/**
 * useRelay.ts — relay lifecycle state + controls.
 *
 * One shared SSE connection for the whole app (top bar, dashboard and admin
 * all read the same store). On a phone every extra long-lived socket costs
 * battery, so this is deliberately a module-level store rather than a hook
 * that opens its own stream per component.
 */
import { useCallback, useSyncExternalStore } from "react";
import { Api, errorMessage } from "../api";
import { openSSE, type SSEHandle } from "../sse";
import { toastStore } from "./useToast";
import type { RelayStatus } from "../types";

interface RelayStoreState {
  status: RelayStatus | null;
  connected: boolean;
  busy: boolean;
  error: string | null;
}

type Listener = () => void;

class RelayStore {
  private state: RelayStoreState = { status: null, connected: false, busy: false, error: null };
  private listeners = new Set<Listener>();
  private handle: SSEHandle | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getState = (): RelayStoreState => this.state;

  private set(patch: Partial<RelayStoreState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  async refresh(): Promise<void> {
    try {
      const data = await Api.get<RelayStatus>("/api/relay/status");
      this.set({ status: data, error: null });
    } catch (error) {
      this.set({ error: errorMessage(error) });
    }
  }

  connect(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    this.open();
  }

  private open() {
    this.handle = openSSE<RelayStatus>("/api/relay/stream", {
      onOpen: () => this.set({ connected: true }),
      onMessage: (_event, data) => {
        if (data && typeof data.state === "string") this.set({ status: data });
      },
      onError: () => this.reconnect(),
      onDone: () => this.reconnect(),
    });
  }

  private reconnect() {
    this.handle?.close();
    this.handle = null;
    this.set({ connected: false });
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.open();
    }, 4000);
  }

  private async run(action: () => Promise<unknown>, successMessage: string): Promise<void> {
    this.set({ busy: true });
    try {
      await action();
      await this.refresh();
      toastStore.success(successMessage);
    } catch (error) {
      toastStore.error("Relay action failed", errorMessage(error));
    } finally {
      this.set({ busy: false });
    }
  }

  start = () => this.run(() => Api.post("/api/relay/start"), "Relay started");
  stop = () => this.run(() => Api.post("/api/relay/stop", { killExternal: false }), "Relay stopped");
  restart = () => this.run(() => Api.post("/api/relay/restart"), "Relay restarted");
  killExternal = (confirmPort: number) =>
    this.run(
      () => Api.post("/api/relay/kill-external", { confirmPort, confirmText: "KILL" }),
      "External relay killed",
    );
}

export const relayStore = new RelayStore();

export interface UseRelayResult extends RelayStoreState {
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  killExternal: (confirmPort: number) => Promise<void>;
}

export function useRelay(): UseRelayResult {
  const state = useSyncExternalStore(relayStore.subscribe, relayStore.getState, relayStore.getState);
  relayStore.connect();

  const refresh = useCallback(() => relayStore.refresh(), []);
  const start = useCallback(() => relayStore.start(), []);
  const stop = useCallback(() => relayStore.stop(), []);
  const restart = useCallback(() => relayStore.restart(), []);
  const killExternal = useCallback((port: number) => relayStore.killExternal(port), []);

  return { ...state, refresh, start, stop, restart, killExternal };
}
