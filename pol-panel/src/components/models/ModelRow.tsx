import { cn, truncateMiddle } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ModelToggle } from "./ModelToggle";
import { TestBadge } from "./TestBadge";
import { useModels } from "@/lib/hooks/useModels";
import type { RelayModel } from "@/lib/types";

export interface ModelRowProps {
  model: RelayModel;
  /** Highlight the row while a bulk action touches it. */
  highlight?: boolean;
}

export function ModelRow({ model, highlight }: ModelRowProps) {
  const { tests, test } = useModels();
  const state = tests[model.id];
  const running = state?.status === "running";
  const failing = state?.status === "done" && state.result ? !state.result.ok : false;

  return (
    <li
      className={cn(
        "glass-card p-3 flex items-center gap-3 transition-colors",
        highlight && "ring-1 ring-indigo-400/50",
        !model.enabled && "opacity-70",
        failing && "border-red-500/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "font-mono text-sm truncate",
              !model.enabled && "line-through decoration-slate-500/60",
            )}
            title={model.id}
          >
            {model.id}
          </span>
          <Badge tone={model.enabled ? "green" : "neutral"} dot>
            <span className="sr-only sm:not-sr-only">{model.enabled ? "enabled" : "off"}</span>
            <span className="sm:hidden">{model.enabled ? "on" : "off"}</span>
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--frost-muted)]">
          {model.owned_by ? (
            <span className="truncate max-w-[9rem]" title={String(model.owned_by)}>
              {truncateMiddle(String(model.owned_by), 18)}
            </span>
          ) : null}
          <TestBadge state={state} />
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          loading={running}
          onClick={() => void test(model.id)}
          aria-label={`Test ${model.id}`}
          title={`Test ${model.id}`}
        >
          {!running ? <Icon name="bolt" size={16} /> : null}
        </Button>
        <ModelToggle model={model} />
      </div>
    </li>
  );
}
