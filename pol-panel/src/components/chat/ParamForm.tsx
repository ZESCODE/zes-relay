import { cn } from "@/lib/format";
import { Field, Input } from "@/components/ui/Input";
import type { ChatParams } from "@/lib/types";

export interface ParamFormProps {
  params: ChatParams;
  onChange: (params: ChatParams) => void;
  busy?: boolean;
}

export const DEFAULT_PARAMS: ChatParams = {
  temperature: 0.7,
  top_p: 1,
  max_tokens: 512,
  presence_penalty: 0,
  frequency_penalty: 0,
  seed: null,
  stop: "",
  stream: true,
};

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

function SliderRow({ label, value, min, max, step, disabled, onChange, format }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs text-[var(--frost-muted)] uppercase tracking-wide">{label}</label>
        <span className="text-xs tabular-nums font-mono">
          {format ? format(value) : value}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
          className="h-9 flex-1 accent-indigo-400"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={`${label} (exact)`}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            "glass-input w-20 px-2 py-1.5 text-xs font-mono tabular-nums",
            "sm:py-1",
          )}
        />
      </div>
    </div>
  );
}

/** Sampling parameters. Every control is ≥ 36px tall for thumb use. */
export function ParamForm({ params, onChange, busy }: ParamFormProps) {
  const set = <K extends keyof ChatParams>(key: K, value: ChatParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
      <SliderRow
        label="temperature"
        value={params.temperature}
        min={0}
        max={2}
        step={0.05}
        disabled={busy}
        onChange={(value) => set("temperature", value)}
        format={(value) => value.toFixed(2)}
      />
      <SliderRow
        label="top_p"
        value={params.top_p}
        min={0}
        max={1}
        step={0.01}
        disabled={busy}
        onChange={(value) => set("top_p", value)}
        format={(value) => value.toFixed(2)}
      />
      <SliderRow
        label="presence_penalty"
        value={params.presence_penalty}
        min={-2}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={(value) => set("presence_penalty", value)}
        format={(value) => value.toFixed(1)}
      />
      <SliderRow
        label="frequency_penalty"
        value={params.frequency_penalty}
        min={-2}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={(value) => set("frequency_penalty", value)}
        format={(value) => value.toFixed(1)}
      />

      <Field label="max_tokens" htmlFor="param-max-tokens">
        <Input
          id="param-max-tokens"
          type="number"
          min={1}
          max={200000}
          value={params.max_tokens}
          disabled={busy}
          onChange={(event) => set("max_tokens", Math.max(1, Number(event.target.value) || 1))}
          className="font-mono"
        />
      </Field>

      <Field label="seed" htmlFor="param-seed" hint="Leave empty for a random seed">
        <Input
          id="param-seed"
          type="number"
          inputMode="numeric"
          value={params.seed ?? ""}
          disabled={busy}
          placeholder="random"
          onChange={(event) =>
            set("seed", event.target.value === "" ? null : Number(event.target.value))
          }
          className="font-mono"
        />
      </Field>

      <Field label="stop" htmlFor="param-stop" hint="Comma separated sequences">
        <Input
          id="param-stop"
          value={params.stop}
          disabled={busy}
          placeholder="\n, ###"
          onChange={(event) => set("stop", event.target.value)}
          className="font-mono"
        />
      </Field>

      <Field label="stream" htmlFor="param-stream" hint="Token-by-token rendering">
        <label
          htmlFor="param-stream"
          className="glass-input flex h-11 sm:h-10 items-center gap-2 px-3 text-sm cursor-pointer"
        >
          <input
            id="param-stream"
            type="checkbox"
            checked={params.stream}
            disabled={busy}
            onChange={(event) => set("stream", event.target.checked)}
            className="h-4 w-4 accent-indigo-400"
          />
          {params.stream ? "streaming on" : "single response"}
        </label>
      </Field>
    </div>
  );
}
