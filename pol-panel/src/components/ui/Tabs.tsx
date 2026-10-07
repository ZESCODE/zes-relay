import { cn } from "@/lib/format";

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: Array<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}

/** Horizontal, scroll-safe tab strip. Chips are used for the model filters. */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className,
  size = "md",
  ariaLabel = "Tabs",
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              const index = items.findIndex((i) => i.value === value);
              const next =
                event.key === "ArrowRight"
                  ? items[(index + 1) % items.length]
                  : items[(index - 1 + items.length) % items.length];
              if (next) onChange(next.value);
            }}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 rounded-full border transition-colors",
              size === "sm" ? "h-9 px-3 text-xs" : "h-11 sm:h-9 px-3.5 text-sm",
              active
                ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100"
                : "border-[var(--frost-border-strong)] text-[var(--frost-muted)] hover:text-[var(--frost-text)]",
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] leading-none tabular-nums",
                  active ? "bg-indigo-400/25 text-indigo-50" : "bg-white/10",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
