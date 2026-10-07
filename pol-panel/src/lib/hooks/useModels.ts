/**
 * useModels.ts — the shared model store behind every model-aware screen.
 *
 * Toggle truth rule (BUILD-PROMPT §5.10): after every mutation the UI state
 * equals the relay's `data.enabled`. A 200 response is a success even when it
 * reports enabled=false; a mismatch reconciles to the server and warns.
 */
import { useSyncExternalStore } from "react";
import { Api, errorMessage } from "../api";
import { openSSE, type SSEHandle } from "../sse";
import { toastStore } from "./useToast";
import type { RelayModel, RelayTestResult, RowTestState } from "../types";

export type ModelChip = "all" | "enabled" | "disabled" | "failing";

export interface TestRunState {
  active: boolean;
  mode: "sequential" | "batch";
  total: number;
  tested: number;
  passed: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface ModelsState {
  models: RelayModel[];
  loading: boolean;
  error: string | null;
  at: number;
  pending: Record<string, boolean>;
  tests: Record<string, RowTestState>;
  run: TestRunState | null;
  sortByTest: boolean;
  streamConnected: boolean;
}

const EMPTY: ModelsState = {
  models: [],
  loading: true,
  error: null,
  at: 0,
  pending: {},
  tests: {},
  run: null,
  sortByTest: false,
  streamConnected: false,
};

type Listener = () => void;

const FILTER_STORAGE_KEY = "pol-panel.models.filter";

export class ModelStore {
  private state: ModelsState = EMPTY;
  private listeners = new Set<Listener>();
  private lastToggle = new Map<string, number>();
  private handle: SSEHandle | null = null;
  private runHandle: SSEHandle | null = null;
  private streamRetry: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getState = (): ModelsState => this.state;

  private set(patch: Partial<ModelsState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private patchModel(id: string, patch: Partial<RelayModel>) {
    this.set({
      models: this.state.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  }

  private setPending(id: string, pending: boolean) {
    this.set({ pending: { ...this.state.pending, [id]: pending } });
  }

  private setTest(id: string, state: RowTestState) {
    this.set({ tests: { ...this.state.tests, [id]: state } });
  }

  // ── loading ──────────────────────────────────────────────────────────────
  async refresh({ silent = false, force = false } = {}): Promise<void> {
    if (!silent) this.set({ loading: this.state.models.length === 0, error: null });
    try {
      const data = await Api.get<{ models: RelayModel[]; at: number }>(
        `/api/models${force ? "?refresh=1" : ""}`,
      );
      const tests = { ...this.state.tests };
      for (const model of data.models) {
        const remote = model.last_test;
        if (!remote) continue;
        const local = tests[model.id]?.result;
        if (local && local.ts >= remote.ts) continue;
        tests[model.id] = { status: "done", result: remote };
      }
      this.set({ models: data.models, tests, at: data.at, loading: false, error: null });
    } catch (error) {
      const message = errorMessage(error);
      this.set({ loading: false, error: message });
      if (!silent) toastStore.error("Cannot load models", message);
    }
  }

  /** Coalesce bursts of invalidation events into a single refetch. */
  private scheduleRefresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh({ silent: true });
    }, 250);
  }

  // ── toggles ──────────────────────────────────────────────────────────────
  async toggle(id: string): Promise<void> {
    if (this.state.pending[id]) return;
    const now = Date.now();
    if (now - (this.lastToggle.get(id) ?? 0) < 300) return; // per-model debounce
    this.lastToggle.set(id, now);

    const model = this.state.models.find((m) => m.id === id);
    if (!model) return;
    const expected = !model.enabled;

    this.patchModel(id, { enabled: expected }); // optimistic
    this.setPending(id, true);
    try {
      const data = await Api.post<{ id: string; enabled: boolean }>("/api/models/toggle", { id });
      this.patchModel(id, { enabled: data.enabled });
      if (data.enabled !== expected) {
        toastStore.warn(
          "Relay won the race",
          `${id} is ${data.enabled ? "enabled" : "disabled"} on the server — UI reconciled.`,
        );
      }
    } catch (error) {
      this.patchModel(id, { enabled: !expected }); // revert
      toastStore.error(`Toggle failed for ${id}`, errorMessage(error));
    } finally {
      this.setPending(id, false);
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    if (this.state.pending[id]) return false;
    this.setPending(id, true);
    try {
      const data = await Api.post<{ id: string; enabled: boolean }>(
        `/api/models/${enabled ? "enable" : "disable"}`,
        { id },
      );
      this.patchModel(id, { enabled: data.enabled });
      return data.enabled === enabled;
    } catch (error) {
      toastStore.error(`${enabled ? "Enable" : "Disable"} failed for ${id}`, errorMessage(error));
      return false;
    } finally {
      this.setPending(id, false);
    }
  }

  /** Sequential by design: the relay persists models.json on every mutation. */
  async bulk(target: "enable" | "disable"): Promise<{ changed: number; failed: number }> {
    const ids = this.state.models
      .filter((m) => (target === "enable" ? !m.enabled : m.enabled))
      .map((m) => m.id);
    let changed = 0;
    let failed = 0;
    for (const id of ids) {
      const result = await this.setEnabled(id, target === "enable");
      if (result) changed += 1;
      else failed += 1;
    }
    if (ids.length === 0) toastStore.info(`Nothing to ${target}`, "No models in that state.");
    else if (failed === 0) toastStore.success(`${target === "enable" ? "Enabled" : "Disabled"} ${changed} model${changed === 1 ? "" : "s"}`);
    return { changed, failed };
  }

  async reset(): Promise<boolean> {
    try {
      await Api.post<{ disabled: string[] }>("/api/models/reset");
      this.set({
        models: this.state.models.map((m) => ({ ...m, enabled: true })),
        sortByTest: false,
      });
      toastStore.success("Reset complete", "Every model is enabled again.");
      return true;
    } catch (error) {
      toastStore.error("Reset failed", errorMessage(error));
      return false;
    }
  }

  // ── tests ────────────────────────────────────────────────────────────────
  async test(id: string): Promise<RelayTestResult | null> {
    this.setTest(id, { status: "running" });
    try {
      const result = await Api.post<RelayTestResult & { id: string }>("/api/models/test", { id });
      this.setTest(id, { status: "done", result });
      if (!result.ok) {
        toastStore.warn(`${id} failed`, `${result.status} · ${result.error || "no response"}`.slice(0, 140));
      }
      return result;
    } catch (error) {
      this.setTest(id, { status: "idle", error: errorMessage(error) });
      toastStore.error(`Test failed for ${id}`, errorMessage(error));
      return null;
    }
  }

  testAll(mode: "sequential" | "batch" = "sequential"): void {
    if (this.state.run?.active) return;
    const total = this.state.models.length;
    this.set({
      run: { active: true, mode, total, tested: 0, passed: 0, failed: 0, startedAt: Date.now(), finishedAt: null },
      tests: Object.fromEntries(
        this.state.models.map((m) => [m.id, { status: "running" } as RowTestState]),
      ),
    });

    let handle: SSEHandle | null = null;
    const finish = (cancelled: boolean) => {
      const run = this.state.run;
      this.set({
        run: run ? { ...run, active: false, finishedAt: Date.now() } : null,
        tests: Object.fromEntries(
          Object.entries(this.state.tests).map(([id, t]) => [
            id,
            t.status === "running" ? { status: "idle" as const } : t,
          ]),
        ),
      });
      this.applyTestSort();
      if (!cancelled && run) {
        const failed = this.state.run?.failed ?? run.failed;
        if (failed > 0) toastStore.warn(`Test run complete`, `${run.tested} tested · ${failed} failing`);
        else toastStore.success("All models healthy", `${run.tested} tested`);
      }
    };

    handle = openSSE<{ id?: string; total?: number; tested?: number; passed?: number; failed?: number; cancelled?: boolean; message?: string; code?: string } & Partial<RelayTestResult>>(
      `/api/models/test-all/stream?mode=${mode}`,
      {
        onMessage: (event, data) => {
          if (event === "plan" && data.total !== undefined) {
            const run = this.state.run;
            if (run) this.set({ run: { ...run, total: data.total } });
          } else if (event === "result" && data.id) {
            const id = data.id;
            const result: RelayTestResult = {
              ok: Boolean(data.ok),
              status: Number(data.status ?? 0),
              latency_ms: Number(data.latency_ms ?? 0),
              ts: Number(data.ts ?? Date.now()),
              ...(data.error ? { error: String(data.error) } : {}),
            };
            this.setTest(id, { status: "done", result });
            const run = this.state.run;
            if (run) {
              this.set({
                run: {
                  ...run,
                  tested: run.tested + 1,
                  passed: run.passed + (result.ok ? 1 : 0),
                  failed: run.failed + (result.ok ? 0 : 1),
                },
              });
            }
          } else if (event === "done") {
            finish(Boolean(data.cancelled));
          } else if (event === "error") {
            toastStore.error("Test run failed", data.message || data.code || "unknown error");
            finish(true);
          }
        },
        onError: (error) => {
          toastStore.error("Test stream dropped", errorMessage(error));
          finish(true);
        },
        onDone: () => {
          if (this.state.run?.active) finish(true);
        },
      },
    );
    this.runHandle = handle;
  }

  cancelTestAll(): void {
    this.runHandle?.close();
    this.runHandle = null;
    const run = this.state.run;
    this.set({
      run: run ? { ...run, active: false, finishedAt: Date.now() } : null,
      tests: Object.fromEntries(
        Object.entries(this.state.tests).map(([id, t]) => [
          id,
          t.status === "running" ? { status: "idle" as const } : t,
        ]),
      ),
    });
    this.applyTestSort();
    toastStore.info("Test run cancelled", "Remaining models left untested.");
  }

  /** Failure-first, then latency ascending (BUILD-PROMPT §3.2). */
  applyTestSort(): void {
    const tests = this.state.tests;
    const rank = (id: string) => {
      const result = tests[id]?.result;
      if (!result) return 2;
      return result.ok ? 1 : 0;
    };
    const models = [...this.state.models].sort((a, b) => {
      const diff = rank(a.id) - rank(b.id);
      if (diff !== 0) return diff;
      const la = tests[a.id]?.result?.latency_ms ?? Number.POSITIVE_INFINITY;
      const lb = tests[b.id]?.result?.latency_ms ?? Number.POSITIVE_INFINITY;
      return la - lb;
    });
    this.set({ models, sortByTest: true });
  }

  clearSort(): void {
    this.set({ sortByTest: false });
    void this.refresh({ silent: true, force: true });
  }

  // ── cross-tab invalidation ───────────────────────────────────────────────
  connectStream(): void {
    if (this.handle || this.streamRetry) return;
    const open = () => {
      this.streamRetry = null;
      this.handle = openSSE<Record<string, unknown>>("/api/models/stream", {
        onOpen: () => this.set({ streamConnected: true }),
        onMessage: (event, data) => {
          if (event === "change") this.scheduleRefresh();
          else if (event === "test" && typeof data?.id === "string") {
            const id = data.id as string;
            const result = data.result as RelayTestResult | undefined;
            if (result) this.setTest(id, { status: "done", result });
          }
        },
        onError: () => this.reconnect(),
        onDone: () => this.reconnect(),
      });
    };
    this.handle = null;
    open();
  }

  private reconnect() {
    this.handle = null;
    this.set({ streamConnected: false });
    if (this.streamRetry) return;
    this.streamRetry = setTimeout(() => {
      this.streamRetry = null;
      this.connectStream();
    }, 4000);
  }
}

export const modelsStore = new ModelStore();

let storeStarted = false;
function ensureStarted() {
  if (storeStarted || typeof window === "undefined") return;
  storeStarted = true;
  modelsStore.connectStream();
  void modelsStore.refresh({ silent: true });
}

export interface UseModelsResult extends ModelsState {
  refresh: (opts?: { silent?: boolean; force?: boolean }) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  bulk: (target: "enable" | "disable") => Promise<{ changed: number; failed: number }>;
  reset: () => Promise<boolean>;
  test: (id: string) => Promise<RelayTestResult | null>;
  testAll: (mode?: "sequential" | "batch") => void;
  cancelTestAll: () => void;
  clearSort: () => void;
  enabledModels: RelayModel[];
  disabledModels: RelayModel[];
}

export function useModels(): UseModelsResult {
  ensureStarted();
  const state = useSyncExternalStore(modelsStore.subscribe, modelsStore.getState, modelsStore.getState);
  return {
    ...state,
    refresh: (opts) => modelsStore.refresh(opts),
    toggle: (id) => modelsStore.toggle(id),
    setEnabled: (id, enabled) => modelsStore.setEnabled(id, enabled),
    bulk: (target) => modelsStore.bulk(target),
    reset: () => modelsStore.reset(),
    test: (id) => modelsStore.test(id),
    testAll: (mode) => modelsStore.testAll(mode),
    cancelTestAll: () => modelsStore.cancelTestAll(),
    clearSort: () => modelsStore.clearSort(),
    enabledModels: state.models.filter((m) => m.enabled),
    disabledModels: state.models.filter((m) => !m.enabled),
  };
}

/** Last-used filter chip, persisted (BUILD-PROMPT §3.1). */
export function loadFilter(): ModelChip {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw === "enabled" || raw === "disabled" || raw === "failing" || raw === "all") return raw;
  } catch {
    /* private mode */
  }
  return "all";
}

export function saveFilter(chip: ModelChip): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, chip);
  } catch {
    /* private mode */
  }
}
