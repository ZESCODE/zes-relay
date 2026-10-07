import { useCallback, useEffect, useRef, useState } from "react";
import { Api, errorMessage } from "@/lib/api";
import { fmtAgo, fmtBytes } from "@/lib/format";
import { toastStore } from "@/lib/hooks/useToast";
import { useRelay } from "@/lib/hooks/useRelay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Shell } from "@/components/layout/Shell";
import { TokenTable } from "@/components/admin/TokenTable";
import type { AdminInfo, BackupEntry } from "@/lib/types";

const SHORTCUTS: Array<[string, string]> = [
  ["g d", "Dashboard"],
  ["g m", "Models"],
  ["g p", "Playground"],
  ["g l", "Logs"],
  ["g c", "Config"],
  ["g a", "Admin"],
  ["?", "This help"],
  ["t / e / x", "On Models: test all / enable all / disable all"],
  ["/", "Focus the model search"],
];

export function Admin() {
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const relay = useRelay();

  const load = useCallback(async () => {
    try {
      const [infoData, backupData] = await Promise.all([
        Api.get<AdminInfo>("/api/admin/info"),
        Api.get<{ backups: BackupEntry[] }>("/api/admin/backups"),
      ]);
      setInfo(infoData);
      setBackups(backupData.backups);
    } catch (error) {
      toastStore.error("Cannot load admin info", errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await action();
      toastStore.success(message);
      await load();
    } catch (error) {
      toastStore.error("Action failed", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const exportSettings = useCallback(async () => {
    try {
      const data = await Api.get<Record<string, unknown>>("/api/admin/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pol-panel-settings-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toastStore.success("Settings exported", "Secrets are excluded.");
    } catch (error) {
      toastStore.error("Export failed", errorMessage(error));
    }
  }, []);

  const importSettings = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const settings = JSON.parse(text) as Record<string, unknown>;
        await Api.post("/api/admin/import", { settings });
        toastStore.success("Settings imported", "Restart the relay to apply.");
        await load();
      } catch (error) {
        toastStore.error("Import failed", errorMessage(error));
      }
    },
    [load],
  );

  return (
    <Shell title="Admin" subtitle="Runtime, tokens, backups">
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader
            title="Runtime"
            subtitle={info ? `${info.nodeVersion} · ${info.pythonVersion}` : "loading…"}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void load()} aria-label="Reload admin info">
                <Icon name="refresh" size={14} />
              </Button>
            }
          />
          {info ? (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {[
                ["panel", `v${info.panelVersion}`],
                ["node", info.nodeVersion],
                ["python", info.pythonVersion],
                ["sidecar uptime", `${Math.floor(info.uptimeS / 60)}m ${info.uptimeS % 60}s`],
                ["relay script", info.relayScript],
                ["pol_relay.py sha256", info.relaySha256 ? `${info.relaySha256.slice(0, 16)}…` : "missing"],
                ["data dir", info.dataDir],
                ["log file", `${info.logFile} (${fmtBytes(info.logBytes)})`],
                ["relay state", `${info.relay.state}${info.relay.owned ? "" : " (external)"}`],
                ["api tokens", String(info.tokens)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2 min-w-0">
                  <dt className="text-[var(--frost-muted)] shrink-0">{label}</dt>
                  <dd className="font-mono truncate" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="success"
              loading={relay.busy}
              disabled={info?.relay.running}
              onClick={() => void relay.start()}
            >
              Start relay
            </Button>
            <Button size="sm" loading={relay.busy} disabled={!info?.relay.running} onClick={() => void relay.restart()}>
              Restart relay
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={relay.busy}
              disabled={!info?.relay.running}
              onClick={() => void relay.stop()}
            >
              Stop relay
            </Button>
            {info && !info.relay.owned && info.relay.running ? (
              <Button
                size="sm"
                variant="danger"
                loading={relay.busy}
                onClick={() => void relay.killExternal(info.relay.port)}
              >
                Force kill external
              </Button>
            ) : null}
          </div>
        </Card>

        <TokenTable />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card>
            <CardHeader title="Settings" subtitle="Export excludes secrets by default" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void exportSettings()} icon={<Icon name="download" size={14} />}>
                Export JSON
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} icon={<Icon name="plus" size={14} />}>
                Import JSON
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importSettings(file);
                  event.target.value = "";
                }}
              />
              <Button variant="danger" onClick={() => setConfirmClear(true)} icon={<Icon name="trash" size={14} />}>
                Clear metrics &amp; logs
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Backups"
              subtitle="ZIP of data/ (backups folder excluded)"
              actions={
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === "backup"}
                  onClick={() => void run("backup", () => Api.post("/api/admin/backup"), "Backup created")}
                >
                  Create
                </Button>
              }
            />
            {backups.length === 0 ? (
              <p className="text-sm text-[var(--frost-muted)]">No backups yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--frost-border)]">
                {backups.map((backup) => (
                  <li key={backup.name} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="font-mono flex-1 truncate" title={backup.name}>
                      {backup.name}
                    </span>
                    <span className="tabular-nums text-[var(--frost-muted)]">{fmtBytes(backup.bytes)}</span>
                    <span className="tabular-nums text-[var(--frost-muted)]">{fmtAgo(backup.createdAt)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Download ${backup.name}`}
                      onClick={() => {
                        window.location.href = `/api/admin/backups/${encodeURIComponent(backup.name)}`;
                      }}
                    >
                      <Icon name="download" size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-red-300"
                      aria-label={`Delete ${backup.name}`}
                      onClick={() =>
                        void run(
                          `del-${backup.name}`,
                          () => Api.delete(`/api/admin/backups/${encodeURIComponent(backup.name)}`),
                          "Backup deleted",
                        )
                      }
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Keyboard shortcuts" subtitle="Desktop only" />
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {SHORTCUTS.map(([keys, description]) => (
              <li key={keys} className="flex items-center gap-2">
                <Badge tone="neutral">
                  <span className="font-mono">{keys}</span>
                </Badge>
                <span className="text-[var(--frost-muted)]">{description}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        tone="danger"
        title="Clear metrics and logs?"
        description="In-memory counters and the log buffer are dropped. The relay is untouched."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === "clear"}
              onClick={async () => {
                await run("clear", () => Api.post("/api/admin/clear", { metrics: true, logs: true }), "Metrics and logs cleared");
                setConfirmClear(false);
              }}
            >
              Clear everything
            </Button>
          </>
        }
      >
        <p className="text-[var(--frost-muted)]">
          <span className="font-mono">data/logs/panel.jsonl</span> keeps its history on disk; only the
          in-memory ring buffer is cleared.
        </p>
      </Modal>
    </Shell>
  );
}
