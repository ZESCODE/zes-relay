import { useCallback, useEffect, useMemo, useState } from "react";
import { Api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { toastStore } from "@/lib/hooks/useToast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Field, Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ConfigPayload, ConfigSpec } from "@/lib/types";

function validate(spec: ConfigSpec, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return spec.type === "int" && spec.key === "POL_RELAY_PORT" ? "required" : null;
  switch (spec.type) {
    case "int": {
      if (!/^-?\d+$/.test(trimmed)) return "must be an integer";
      const n = Number(trimmed);
      if (spec.min !== undefined && n < spec.min) return `minimum ${spec.min}`;
      if (spec.max !== undefined && n > spec.max) return `maximum ${spec.max}`;
      return null;
    }
    case "bool":
      return ["true", "false"].includes(trimmed) ? null : "must be true or false";
    case "url": {
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return "must be a valid URL";
      }
      return ["http:", "https:"].includes(parsed.protocol) ? null : "must use http or https";
    }
    default:
      return null;
  }
}

export function EnvEditor() {
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await Api.get<ConfigPayload>("/api/config");
      setConfig(data);
      setValues(data.values);
      setRevealed({});
    } catch (error) {
      toastStore.error("Cannot load config", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const errors = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const spec of config?.specs ?? []) map[spec.key] = validate(spec, values[spec.key] ?? "");
    return map;
  }, [config, values]);

  const invalid = Object.values(errors).some(Boolean);

  const save = useCallback(
    async (restart: boolean) => {
      if (invalid) {
        toastStore.error("Fix the highlighted fields first");
        return;
      }
      if (restart) setRestarting(true);
      else setSaving(true);
      try {
        const endpoint = restart ? "/api/config/save-restart" : "/api/config";
        const data = await Api.post<{ values: Record<string, string> }>(endpoint, { values });
        setValues(data.values);
        setRevealed({});
        await load();
        toastStore.success(restart ? "Saved & relay restarted" : "Configuration saved", "data/.env updated");
      } catch (error) {
        toastStore.error("Save failed", errorMessage(error));
      } finally {
        setSaving(false);
        setRestarting(false);
      }
    },
    [invalid, load, values],
  );

  const reveal = useCallback(async (key: string) => {
    try {
      const data = await Api.post<{ key: string; value: string }>("/api/config/reveal", { key });
      setRevealed((current) => ({ ...current, [key]: data.value }));
      toastStore.warn("Secret revealed", "This read was written to the audit log.");
    } catch (error) {
      toastStore.error("Reveal failed", errorMessage(error));
    }
  }, []);

  if (loading && !config) {
    return <Card className="text-sm text-[var(--frost-muted)]">Loading configuration…</Card>;
  }

  if (!config) {
    return <Card className="text-sm text-red-300">Configuration unavailable.</Card>;
  }

  const diffByKey = Object.fromEntries(config.diff.rows.map((row) => [row.key, row]));

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader
          title="data/.env"
          subtitle={config.file}
          actions={
            <>
              <Badge tone={config.relayState === "running" ? "green" : "orange"} dot>
                relay {config.relayState}
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Reload config">
                <Icon name="refresh" size={14} />
              </Button>
            </>
          }
        />
        <p className="text-xs text-[var(--frost-muted)] mb-3">
          Values are written to <span className="font-mono">data/.env</span> and picked up the next
          time the relay starts. Precedence: process env → file → default.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {config.specs.map((spec) => {
            const diff = diffByKey[spec.key];
            const value = values[spec.key] ?? "";
            const revealedValue = revealed[spec.key];
            const shown = spec.secret ? revealedValue ?? value : value;
            return (
              <Field
                key={spec.key}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {spec.label}
                    <span className="font-mono normal-case tracking-normal opacity-60">{spec.key}</span>
                  </span>
                }
                htmlFor={`cfg-${spec.key}`}
                hint={spec.hint}
                error={errors[spec.key]}
                action={
                  diff?.changed ? (
                    <span
                      className="text-[11px] text-amber-300"
                      title={`running: ${diff.running || "(unset)"}`}
                    >
                      ≠ running
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--frost-muted)]">{diff?.source}</span>
                  )
                }
              >
                {spec.type === "bool" ? (
                  <Select
                    id={`cfg-${spec.key}`}
                    value={value}
                    onChange={(event) => setValues((v) => ({ ...v, [spec.key]: event.target.value }))}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : (
                  <div className="flex gap-1.5">
                    <Input
                      id={`cfg-${spec.key}`}
                      type={spec.secret && revealedValue === undefined ? "password" : "text"}
                      inputMode={spec.type === "int" ? "numeric" : undefined}
                      value={shown}
                      mono
                      invalid={Boolean(errors[spec.key])}
                      placeholder={spec.def || "(unset)"}
                      autoComplete="off"
                      onChange={(event) =>
                        setValues((v) => ({ ...v, [spec.key]: event.target.value }))
                      }
                      className="flex-1"
                    />
                    {spec.secret ? (
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => void reveal(spec.key)}
                        aria-label={`Reveal ${spec.label}`}
                        title="Reveal (audited)"
                        className="shrink-0"
                      >
                        <Icon name={revealedValue === undefined ? "eye" : "eyeOff"} size={16} />
                      </Button>
                    ) : null}
                  </div>
                )}
              </Field>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <Button variant="primary" loading={saving} disabled={invalid} onClick={() => void save(false)}>
            Save
          </Button>
          <Button variant="success" loading={restarting} disabled={invalid} onClick={() => void save(true)}>
            Save &amp; restart relay
          </Button>
          {config.diff.changed ? (
            <span className="self-center text-xs text-amber-300">
              The running relay still uses older values.
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Effective vs running" subtitle="What the relay was started with" />
        <ul className="flex flex-col divide-y divide-[var(--frost-border)]">
          {config.diff.rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="font-mono w-44 shrink-0 truncate">{row.key}</span>
              <span className={cn("flex-1 truncate font-mono", row.changed && "text-amber-300")}>
                {row.effective || "—"}
              </span>
              <span className="w-32 shrink-0 truncate text-right font-mono text-[var(--frost-muted)]">
                {row.running || "—"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
