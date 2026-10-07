import { cn } from "@/lib/format";
import { Spinner } from "./Spinner";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  id?: string;
  className?: string;
}

/**
 * The per-model activation switch.
 * role="switch" + aria-checked for screen readers, and a 44px hit area on
 * phones even though the visible track is smaller.
 */
export function Switch({ checked, onChange, disabled, loading, label, id, className }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative inline-flex items-center justify-center shrink-0",
        // generous touch target on coarse pointers
        "h-11 w-16 sm:h-8 sm:w-14",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className,
      )}
    >
      <span
        className={cn(
          "relative block rounded-full transition-colors duration-200",
          "h-7 w-12 sm:h-6 sm:w-11",
          checked
            ? "bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.45)]"
            : "bg-slate-500/40 dark:bg-slate-600/50",
          "border",
          checked ? "border-emerald-400/60" : "border-white/10",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-1/2 grid place-items-center -translate-y-1/2",
            "h-6 w-6 sm:h-5 sm:w-5 rounded-full bg-white shadow-md",
            "transition-transform duration-200",
            // 24px knob in a 48px track / 20px knob in a 44px track, both land
            // 2px from the far edge.
            checked ? "translate-x-[calc(100%-4px)] sm:translate-x-full" : "translate-x-0",
          )}
        >
          {loading ? <Spinner size={12} className="text-slate-700" /> : null}
        </span>
      </span>
    </button>
  );
}
