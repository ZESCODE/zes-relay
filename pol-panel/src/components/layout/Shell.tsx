import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";
import { useRelay } from "@/lib/hooks/useRelay";
import { sessionStore, useSession } from "@/lib/hooks/useSession";

export interface ShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Persistent "the relay is not healthy" banner — errors are never swallowed. */
function RelayBanner() {
  const { status, busy, start, restart, killExternal } = useRelay();
  const [confirmKill, setConfirmKill] = useState(false);

  if (!status) return null;
  const unhealthy = status.state !== "running" || (status.lastHealth ? !status.lastHealth.ok : false);
  if (!unhealthy) return null;

  const crashed = status.state === "crashed";
  const stopped = status.state === "stopped";

  return (
    <div
      role="alert"
      className={cn(
        "mx-3 sm:mx-5 mt-3 rounded-xl p-3 text-sm flex flex-wrap items-center gap-2",
        crashed ? "frost-red" : "frost-orange",
      )}
    >
      <Icon name="warning" size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {crashed
            ? "Relay crashed and stopped retrying"
            : stopped
              ? "Relay is stopped"
              : "Relay is not answering health checks"}
        </p>
        <p className="text-xs opacity-85 break-words">
          {status.lastError || status.lastHealth?.error || `state: ${status.state}`}
          {status.restartCount > 0 ? ` · ${status.restartCount} auto-restart(s) used` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {stopped ? (
          <Button size="sm" variant="success" loading={busy} onClick={() => void start()}>
            Start
          </Button>
        ) : (
          <Button size="sm" loading={busy} onClick={() => void restart()}>
            Restart
          </Button>
        )}
        {!status.owned ? (
          <Button size="sm" variant="danger" onClick={() => setConfirmKill(true)}>
            Force kill
          </Button>
        ) : null}
      </div>

      <Modal
        open={confirmKill}
        onClose={() => setConfirmKill(false)}
        tone="danger"
        title="Force kill an external relay?"
        description={`This relay was not spawned by the panel. Killing it may interrupt traffic you do not control. Port ${status.port}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmKill(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                await killExternal(status.port);
                setConfirmKill(false);
              }}
            >
              Yes, kill it
            </Button>
          </>
        }
      >
        <p className="text-[var(--frost-muted)]">
          The panel never kills a process it did not spawn without this explicit, double-confirmed
          override.
        </p>
      </Modal>
    </div>
  );
}

export function Shell({ title, subtitle, actions, children }: ShellProps) {
  const { user, loading } = useSession();

  // Re-check the session when the app returns to the foreground: on a phone
  // the tab can be backgrounded for hours and the cookie may have expired.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void sessionStore.load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="min-h-[100dvh]">
      <aside
        className={cn(
          "hidden md:flex fixed inset-y-0 left-0 w-64 flex-col gap-4 p-4",
          "border-r border-[var(--frost-border)] glass",
        )}
      >
        <div className="flex items-center gap-2.5 px-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl glass-btn-primary">
            <Icon name="bolt" size={18} className="text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">pol-panel</p>
            <p className="text-xs text-[var(--frost-muted)] truncate">
              {user ? user.username : loading ? "…" : "signed out"}
            </p>
          </div>
        </div>
        <Sidebar />
        <div className="mt-auto text-xs text-[var(--frost-muted)] px-1">
          <p>zes-relay control panel</p>
          <p className="opacity-70">127.0.0.1 sidecar · no telemetry</p>
        </div>
      </aside>

      <div className="md:pl-64 flex min-h-[100dvh] flex-col">
        <TopBar title={title} subtitle={subtitle} actions={actions} />
        <RelayBanner />
        <main className="flex-1 px-3 sm:px-5 py-3 sm:py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">
          {children}
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}
