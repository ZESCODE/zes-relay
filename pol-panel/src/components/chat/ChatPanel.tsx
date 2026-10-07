import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Api, ApiError, csrfToken, errorMessage } from "@/lib/api";
import { iterSSE } from "@/lib/sse";
import { cn, fmtMs, newId } from "@/lib/format";
import { toastStore } from "@/lib/hooks/useToast";
import { useModels } from "@/lib/hooks/useModels";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { MessageList, emptyMessage } from "./MessageList";
import { ParamForm, DEFAULT_PARAMS } from "./ParamForm";
import type { ChatMessage, ChatParams, ChatUsage, Preset, RelayModel } from "@/lib/types";

interface AvailableModel {
  id: string;
  enabled: boolean;
}

interface RunStats {
  ttfb: number;
  total: number;
  usage: ChatUsage | null;
}

const DEFAULT_MESSAGES: ChatMessage[] = [
  { id: "seed-system", role: "system", content: "You are a terse, precise assistant." },
  { id: "seed-user", role: "user", content: "Say hello in exactly five words." },
];

function buildBody(model: string, messages: ChatMessage[], params: ChatParams) {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    temperature: params.temperature,
    top_p: params.top_p,
    max_tokens: params.max_tokens,
    presence_penalty: params.presence_penalty,
    frequency_penalty: params.frequency_penalty,
    stream: params.stream,
  };
  if (params.seed !== null && Number.isFinite(params.seed)) body.seed = params.seed;
  const stop = params.stop
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (stop.length > 0) body.stop = stop.length === 1 ? stop[0] : stop;
  return body;
}

export function ChatPanel() {
  const { models, refresh } = useModels();
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [showDisabled, setShowDisabled] = useState(false);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
  const [params, setParams] = useState<ChatParams>(DEFAULT_PARAMS);

  const [sending, setSending] = useState(false);
  const [output, setOutput] = useState("");
  const [stats, setStats] = useState<RunStats | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [rawRequest, setRawRequest] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // ── available models (the relay already filters to enabled) ───────────────
  const loadAvailable = useCallback(async (includeDisabled: boolean) => {
    try {
      const data = await Api.get<{ models: RelayModel[] }>(
        `/api/models/available${includeDisabled ? "?all=true" : ""}`,
      );
      const list = data.models
        .map((m) => ({ id: m.id, enabled: m.enabled !== false }))
        .filter((m) => m.id);
      setAvailable(list);
      setModel((current) => {
        if (current && list.some((m) => m.id === current && (includeDisabled || m.enabled))) {
          return current;
        }
        const firstEnabled = list.find((m) => m.enabled);
        return firstEnabled?.id ?? list[0]?.id ?? "";
      });
    } catch (err) {
      toastStore.error("Cannot load model list", errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadAvailable(showDisabled);
  }, [showDisabled, loadAvailable]);

  // ── if the selected model is disabled elsewhere, swap and tell the user ──
  useEffect(() => {
    if (!model || models.length === 0) return;
    const known = models.find((m) => m.id === model);
    if (!known || known.enabled) return;
    const firstEnabled = models.find((m) => m.enabled);
    if (!firstEnabled) return;
    setModel(firstEnabled.id);
    toastStore.warn("Model switched", `${model} was disabled — now using ${firstEnabled.id}.`);
  }, [models, model]);

  // ── presets ───────────────────────────────────────────────────────────────
  const loadPresets = useCallback(async () => {
    try {
      const data = await Api.get<{ presets: Preset[] }>("/api/presets");
      setPresets(data.presets);
    } catch {
      /* presets are optional */
    }
  }, []);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    // keep the newest token visible while streaming
    if (params.stream && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, params.stream]);

  const selected = available.find((m) => m.id === model);
  const selectedDisabled = Boolean(selected && !selected.enabled);

  const send = useCallback(async () => {
    if (!model) {
      toastStore.error("Pick a model first", "The relay has no enabled models right now.");
      return;
    }
    if (selectedDisabled) {
      toastStore.error("Model is disabled", "Enable it on the Models page.");
      return;
    }
    const trimmed = messages.filter((m) => m.content.trim().length > 0);
    if (trimmed.length === 0) {
      toastStore.error("Nothing to send", "Add at least one non-empty message.");
      return;
    }

    const body = buildBody(model, trimmed, params);
    setRawRequest(JSON.stringify(body, null, 2));
    setRawResponse("");
    setOutput("");
    setStats(null);
    setError(null);
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();
    let ttfb = 0;
    let acc = "";
    let usage: ChatUsage | null = null;

    const handleChunk = (payload: string) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return;
      }
      const choices = parsed?.choices as Array<Record<string, unknown>> | undefined;
      const delta =
        (choices?.[0]?.delta as Record<string, unknown> | undefined)?.content ??
        choices?.[0]?.text ??
        "";
      if (typeof delta === "string" && delta) {
        acc += delta;
        setOutput(acc);
      }
      const chunkUsage = parsed?.usage as ChatUsage | undefined;
      if (chunkUsage && typeof chunkUsage === "object") usage = chunkUsage;
    };

    try {
      const token = csrfToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: params.stream ? "text/event-stream" : "application/json",
          ...(token ? { "x-csrf-token": token } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      ttfb = performance.now() - startedAt;

      if (!response.ok) {
        const text = await response.text();
        let code = `http_${response.status}`;
        let message = text.slice(0, 400);
        try {
          const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
          code = parsed?.error?.code ?? code;
          message = parsed?.error?.message ?? message;
        } catch {
          /* keep raw */
        }
        setRawResponse(text);
        throw new ApiError(code, message, response.status);
      }

      if (params.stream) {
        for await (const message of iterSSE(response, controller.signal)) {
          if (message.data === "[DONE]") continue;
          handleChunk(message.data);
        }
      } else {
        const text = await response.text();
        setRawResponse(text);
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const choices = parsed?.choices as Array<Record<string, unknown>> | undefined;
          const content =
            (choices?.[0]?.message as Record<string, unknown> | undefined)?.content ?? "";
          if (typeof content === "string") {
            acc = content;
            setOutput(content);
          }
          const bodyUsage = parsed?.usage as ChatUsage | undefined;
          if (bodyUsage) usage = bodyUsage;
        } catch {
          acc = text;
          setOutput(text);
        }
      }
      setStats({ ttfb, total: performance.now() - startedAt, usage });
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        toastStore.info("Stopped", "The stream was cancelled.");
      } else {
        const apiError =
          err instanceof ApiError
            ? err
            : new ApiError("request_failed", errorMessage(err), 0);
        setError(apiError);
        toastStore.error("Request failed", apiError.message);
      }
    } finally {
      setStats((previous) => previous ?? { ttfb, total: performance.now() - startedAt, usage });
      setSending(false);
      abortRef.current = null;
    }
  }, [messages, model, params, selectedDisabled]);

  const enableAndRetry = useCallback(async () => {
    if (!model) return;
    try {
      const result = await Api.post<{ id: string; enabled: boolean }>("/api/models/enable", { id: model });
      if (!result.enabled) {
        toastStore.error("Still disabled", "The relay reports the model as disabled.");
        return;
      }
      await refresh({ silent: true, force: true });
      await loadAvailable(showDisabled);
      toastStore.success(`${model} enabled`, "Retrying the request…");
      setError(null);
      void send();
    } catch (err) {
      toastStore.error("Enable failed", errorMessage(err));
    }
  }, [model, refresh, loadAvailable, showDisabled, send]);

  const savePreset = useCallback(async () => {
    const id = presetName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 40) || newId("preset");
    try {
      const preset = await Api.post<Preset>("/api/presets", {
        id,
        name: presetName.trim() || id,
        model,
        messages,
        params,
      });
      setPresets((current) => [preset, ...current.filter((p) => p.id !== preset.id)]);
      toastStore.success("Preset saved", preset.name);
    } catch (err) {
      toastStore.error("Save failed", errorMessage(err));
    }
  }, [presetName, model, messages, params]);

  const applyPreset = useCallback((preset: Preset) => {
    setModel(preset.model || "");
    setMessages(preset.messages?.length ? preset.messages : DEFAULT_MESSAGES);
    setParams({ ...DEFAULT_PARAMS, ...(preset.params || {}) });
    toastStore.info("Preset loaded", preset.name);
  }, []);

  const modelOptions = useMemo(
    () => (showDisabled ? available : available.filter((m) => m.enabled)),
    [available, showDisabled],
  );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title="Model"
          subtitle="Only enabled models are selectable by default"
          actions={
            <label className="flex items-center gap-2 text-xs text-[var(--frost-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={showDisabled}
                onChange={(event) => setShowDisabled(event.target.checked)}
                className="h-4 w-4 accent-indigo-400"
              />
              Show disabled
            </label>
          }
        />
        <div className="flex flex-col gap-2">
          <Select
            aria-label="Model"
            value={model}
            onChange={(event) => {
              const next = event.target.value;
              const target = available.find((m) => m.id === next);
              if (target && !target.enabled) {
                toastStore.error(
                  "Model is disabled",
                  "Enable it on the Models page before sending.",
                );
                return;
              }
              setModel(next);
            }}
          >
            {modelOptions.length === 0 ? <option value="">no models available</option> : null}
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.enabled}>
                {option.enabled ? option.id : `${option.id} [disabled]`}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--frost-muted)]">
            {selectedDisabled ? (
              <Badge tone="orange">selected model is disabled</Badge>
            ) : (
              <Badge tone="green" dot>
                ready
              </Badge>
            )}
            <span>{available.filter((m) => m.enabled).length} enabled</span>
            {showDisabled ? <span>· {available.length} total</span> : null}
            <Button size="sm" variant="ghost" onClick={() => void loadAvailable(showDisabled)}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <MessageList messages={messages} onChange={setMessages} busy={sending} />
      </Card>

      <Card>
        <CardHeader title="Parameters" subtitle="Sent verbatim to the relay" />
        <ParamForm params={params} onChange={setParams} busy={sending} />
      </Card>

      <Card>
        <CardHeader
          title="Presets"
          subtitle="Stored in data/presets/*.json"
          actions={
            <Button size="sm" variant="ghost" onClick={() => void loadPresets()} aria-label="Reload presets">
              <Icon name="refresh" size={14} />
            </Button>
          }
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="preset name"
              aria-label="Preset name"
              className="flex-1"
            />
            <Button variant="outline" onClick={() => void savePreset()} icon={<Icon name="download" size={14} />}>
              Save current
            </Button>
          </div>
          {presets.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <li key={preset.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="glass-badge hover:bg-white/10 transition-colors"
                  >
                    {preset.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={async () => {
                      try {
                        await Api.delete(`/api/presets/${preset.id}`);
                        setPresets((current) => current.filter((p) => p.id !== preset.id));
                      } catch (err) {
                        toastStore.error("Delete failed", errorMessage(err));
                      }
                    }}
                    className="rounded p-1 text-[var(--frost-muted)] hover:text-red-300"
                  >
                    <Icon name="cross" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-[var(--frost-muted)]">No presets saved yet.</p>
          )}
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          loading={sending}
          onClick={() => void send()}
          icon={<Icon name="send" size={16} />}
        >
          {sending ? "Streaming…" : params.stream ? "Send (stream)" : "Send"}
        </Button>
        {sending ? (
          <Button
            variant="danger"
            size="lg"
            onClick={() => abortRef.current?.abort()}
            icon={<Icon name="stop" size={16} />}
          >
            Stop
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className={cn(
            "rounded-xl p-3 text-sm",
            error.code === "model_disabled" ? "frost-red" : "frost-orange",
          )}
        >
          <div className="flex items-start gap-2">
            <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {error.code === "model_disabled" ? "Model disabled" : `Request failed (${error.code})`}
              </p>
              <p className="text-xs opacity-90 break-words">{error.message}</p>
              {error.status ? (
                <p className="mt-1 text-[11px] opacity-70 tabular-nums">HTTP {error.status}</p>
              ) : null}
            </div>
          </div>
          {error.code === "model_disabled" ? (
            <div className="mt-2">
              <Button size="sm" variant="success" onClick={() => void enableAndRetry()}>
                Enable this model now
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Response"
          subtitle={
            stats ? (
              <span className="tabular-nums">
                TTFB {fmtMs(stats.ttfb)} · total {fmtMs(stats.total)}
                {stats.usage
                  ? ` · ${stats.usage.prompt_tokens}→${stats.usage.completion_tokens} tok`
                  : ""}
              </span>
            ) : (
              "not run yet"
            )
          }
          actions={
            <Button size="sm" variant="ghost" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? "Hide raw" : "Raw"}
            </Button>
          }
        />

        <div
          ref={outputRef}
          className={cn(
            "glass-input max-h-[45dvh] min-h-[7rem] overflow-y-auto p-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap",
          )}
        >
          {output ? (
            output
          ) : sending ? (
            <span className="inline-flex items-center gap-2 text-[var(--frost-muted)]">
              <Spinner size={14} /> waiting for the first token…
            </span>
          ) : (
            <span className="text-[var(--frost-muted)]">The reply appears here, token by token.</span>
          )}
        </div>

        {stats?.usage ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="blue">prompt {stats.usage.prompt_tokens}</Badge>
            <Badge tone="green">completion {stats.usage.completion_tokens}</Badge>
            <Badge tone="violet">total {stats.usage.total_tokens}</Badge>
          </div>
        ) : null}

        {showRaw ? (
          <div className="mt-3 grid gap-2">
            <Field label="Raw request">
              <pre className="glass-input max-h-52 overflow-auto p-2 font-mono text-[11px] whitespace-pre-wrap break-words">
                {rawRequest || "—"}
              </pre>
            </Field>
            <Field label="Raw response">
              <pre className="glass-input max-h-52 overflow-auto p-2 font-mono text-[11px] whitespace-pre-wrap break-words">
                {rawResponse || "—"}
              </pre>
            </Field>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export { emptyMessage };
