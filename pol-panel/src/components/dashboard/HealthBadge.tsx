import { cn } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { RelayStatus } from "@/lib/types";

export interface HealthBadgeProps {
  status: RelayStatus | null;
  showDetails?: boolean;
  className?: string;
}

function toneFor(status: RelayStatus | null): BadgeTone {
  switch (status?.state) {
    case "running":
      return status.owned ? "green" : "blue";
    case "starting":
    case "stopping":
      return "orange";
    case "crashed":
      return "red";
    default:
      return "neutral";
  }
}

function labelFor(status: RelayStatus | null): string {
  switch (status?.state) {
    case "running":
      return status.owned ? "Relay running" : "Relay adopted";
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "crashed":
      return "Crashed";
    case "stopped":
      return "Stopped";
    default:
      return "Unknown";
  }
}

export function HealthBadge({ status, showDetails = false, className }: HealthBadgeProps) {
  const tone = toneFor(status);
  const pulsing = status?.state === "running" || status?.state === "starting";

  return (
    <Badge tone={tone} dot className={cn("gap-2", className)}>
      <span className="inline-flex items-center gap-1.5">
        {pulsing ? (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-soft" />
        ) : null}
        {labelFor(status)}
      </span>
      {showDetails && status?.running ? (
        <span className="tabular-nums opacity-80">
          :{status.port}
          {status.pid ? ` · pid ${status.pid}` : " · external"}
        </span>
      ) : null}
      {status?.healthMisses ? (
        <span className="tabular-nums opacity-80">· {status.healthMisses} missed</span>
      ) : null}
    </Badge>
  );
}
