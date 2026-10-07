import { Shell } from "@/components/layout/Shell";
import { EnvEditor } from "@/components/config/EnvEditor";

export function Config() {
  return (
    <Shell title="Config" subtitle="Relay environment stored in data/.env">
      <EnvEditor />
    </Shell>
  );
}
