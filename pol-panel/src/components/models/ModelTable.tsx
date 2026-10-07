import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ModelRow } from "./ModelRow";
import type { RelayModel } from "@/lib/types";

export interface ModelTableProps {
  models: RelayModel[];
  loading?: boolean;
  error?: string | null;
  highlightIds?: Set<string>;
  emptyState?: ReactNode;
  /** Window size for mobile: rendering 300 glass cards at once stutters. */
  pageSize?: number;
}

export function ModelTable({
  models,
  loading,
  error,
  highlightIds,
  emptyState,
  pageSize = 40,
}: ModelTableProps) {
  const [limit, setLimit] = useState(pageSize);
  const visible = models.slice(0, limit);

  if (loading && models.length === 0) {
    return (
      <div className="glass-card p-8 flex flex-col items-center gap-2 text-sm text-[var(--frost-muted)]">
        <Spinner size={22} label="Loading models" />
        Loading models from the relay…
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="glass-card frost-red p-4 text-sm">
        <p className="font-semibold">Cannot reach the relay</p>
        <p className="mt-1 opacity-85 break-words">{error}</p>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-[var(--frost-muted)]">
        {emptyState ?? "No models match this filter."}
      </div>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {visible.map((model) => (
          <ModelRow key={model.id} model={model} highlight={highlightIds?.has(model.id)} />
        ))}
      </ul>
      {models.length > visible.length ? (
        <div className="mt-3 flex justify-center">
          <Button variant="outline" onClick={() => setLimit((n) => n + pageSize)}>
            Show {Math.min(pageSize, models.length - visible.length)} more ({models.length - visible.length} left)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
