import { Shell } from "@/components/layout/Shell";
import { LogViewer } from "@/components/logs/LogViewer";

export function Logs() {
  return (
    <Shell title="Logs" subtitle="Merged relay stdout/stderr and sidecar access log">
      <LogViewer />
    </Shell>
  );
}
