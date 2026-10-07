import { useState } from "react";
import { cn } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useModels } from "@/lib/hooks/useModels";

export interface TestAllButtonProps {
  disabled?: boolean;
  className?: string;
}

/**
 * One-click "test every model" with a live progress bar.
 *
 * Row-by-row mode calls POST /admin/models/test per model, so results appear as
 * they happen and Cancel actually stops the remaining work. Batch mode fires the
 * relay's single POST /admin/models/test-all and re-emits the finished map
 * row by row over SSE.
 */
export function TestAllButton({ disabled, className }: TestAllButtonProps) {
  const { run, testAll, cancelTestAll, models } = useModels();
  const [mode, setMode] = useState<"sequential" | "batch">("sequential");
  const active = Boolean(run?.active);
  const total = run?.total || models.length || 0;
  const tested = run?.tested ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((tested / total) * 100)) : 0;

  if (active) {
    return (
      <div className={cn("w-full", className)}>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">
                Testing {tested}/{total}
              </span>
              <span className="tabular-nums text-[var(--frost-muted)]">
                <span className="text-emerald-300">{run?.passed ?? 0} passed</span>
                {" · "}
                <span className={cn((run?.failed ?? 0) > 0 ? "text-red-300" : "")}>
                  {run?.failed ?? 0} failed
                </span>
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={tested}
              aria-label="Model test progress"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-400 transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <Button size="sm" variant="danger" onClick={cancelTestAll}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="hidden sm:flex rounded-full border border-[var(--frost-border-strong)] p-0.5 text-xs">
        {(
          [
            ["sequential", "Row by row"],
            ["batch", "Batch"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={cn(
              "h-8 rounded-full px-2.5 transition-colors",
              mode === value
                ? "bg-indigo-500/30 text-indigo-50"
                : "text-[var(--frost-muted)] hover:text-[var(--frost-text)]",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Button
        variant="primary"
        size="md"
        disabled={disabled || models.length === 0}
        onClick={() => testAll(mode)}
        icon={<Icon name="bolt" size={16} />}
      >
        Test all
      </Button>
    </div>
  );
}
