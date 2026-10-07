import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { HealthBadge } from "@/components/dashboard/HealthBadge";
import { useRelay } from "@/lib/hooks/useRelay";
import { useSession } from "@/lib/hooks/useSession";
import { useTheme } from "@/lib/hooks/useTheme";

export interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  const { status } = useRelay();
  const { theme, toggle } = useTheme();
  const { user, logout } = useSession();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 glass-strong border-b border-[var(--frost-border)]",
        "pt-[env(safe-area-inset-top)]",
      )}
    >
      <div className="flex items-center gap-2 px-3 sm:px-5 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">{title}</h1>
          {subtitle ? (
            <p className="hidden sm:block text-xs text-[var(--frost-muted)] truncate">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <HealthBadge status={status} showDetails className="hidden sm:inline-flex" />
          <span className="sm:hidden">
            <HealthBadge status={status} />
          </span>
          {actions}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
          </Button>
          {user ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void logout()}
              aria-label={`Sign out ${user.username}`}
              title={`Signed in as ${user.username} — sign out`}
            >
              <Icon name="logout" size={18} />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
