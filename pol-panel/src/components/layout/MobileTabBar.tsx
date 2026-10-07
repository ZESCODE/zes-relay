import { NavLink } from "react-router-dom";
import { cn } from "@/lib/format";
import { Icon } from "@/components/ui/Icon";
import { NAV_ITEMS } from "./Sidebar";

/**
 * Bottom tab bar for phones. Fixed, glass, with safe-area padding so the home
 * indicator never overlaps a tap target.
 */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Main"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "glass-strong border-t border-[var(--frost-border)]",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="grid grid-cols-6">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-[10px] leading-none",
                  "transition-colors",
                  isActive ? "text-indigo-300" : "text-[var(--frost-muted)]",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={20} />
                  <span className={cn("font-medium", isActive && "text-indigo-200")}>{item.short}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-0.5 w-6 rounded-full transition-opacity",
                      isActive ? "bg-indigo-400 opacity-100" : "opacity-0",
                    )}
                  />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
