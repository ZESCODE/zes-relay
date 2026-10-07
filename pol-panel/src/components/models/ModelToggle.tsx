import { Switch } from "@/components/ui/Switch";
import { useModels } from "@/lib/hooks/useModels";
import type { RelayModel } from "@/lib/types";

export interface ModelToggleProps {
  model: RelayModel;
  /** Read-only mode (e.g. the playground's disabled list). */
  readOnly?: boolean;
}

/**
 * The star of the show: one tap flips a model on or off.
 * Optimistic, debounced per model by the store, spinner while in flight, and
 * always reconciled to the relay's `data.enabled`.
 */
export function ModelToggle({ model, readOnly = false }: ModelToggleProps) {
  const { toggle, pending } = useModels();
  const busy = Boolean(pending[model.id]);

  return (
    <Switch
      checked={model.enabled}
      loading={busy}
      disabled={readOnly}
      onChange={() => void toggle(model.id)}
      label={`${model.enabled ? "Disable" : "Enable"} model ${model.id}`}
    />
  );
}
