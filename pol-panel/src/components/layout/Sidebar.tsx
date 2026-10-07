import { NavLink } from "react-router-dom";
import { cn } from "@/lib/format";
import { Icon, type IconName } from "@/components/ui/Icon";

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: IconName;
  hint: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", short: "Home", icon: "dashboard", hint: "Live metrics" },
  { to: "/models", label: "Models", short: "Models", icon: "models", hint: "Enable / disable" },
  { to: "/playground", label: "Playground", short: "Chat", icon: "playground", hint: "Test a model" },
  { to: "/logs", label: "Logs", short: "Logs", icon: "logs", hint: "Relay output" },
  { to: "/config", label: "Config", short: "Config", icon: "config", hint: "data/.env" },
  { to: "/admin", label: "Admin", short: "Admin", icon: "admin", hint: "Tokens & backups" },
];

export interface SidebarProps {
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ onNavigate, className }: SidebarProps) {
  return (
    <nav aria-label="Main" className={cn("flex flex-col gap-1", className)}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              "min-h-[44px]",
              isActive
                ? "glass-strong text-[var(--frost-text)] border-indigo-400/40"
                : "text-[var(--frost-muted)] hover:text-[var(--frost-text)] hover:bg-[var(--frost-card)]",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className={cn("shrink-0", isActive && "text-indigo-300")}>
                <Icon name={item.icon} size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-xs text-[var(--frost-muted)]">{item.hint}</span>
              </span>
              {isActive ? (
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              ) : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
