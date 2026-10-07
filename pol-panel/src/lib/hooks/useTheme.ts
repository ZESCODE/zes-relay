/**
 * useTheme.ts — dark/light, persisted in a cookie so the sidecar can apply it
 * before first paint (public/theme.js reads the same cookie).
 */
import { useCallback, useSyncExternalStore } from "react";
import { csrfToken } from "../api";

export type Theme = "dark" | "light";

const COOKIE = "pp_theme";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Cookie is written locally first so the choice survives even if the API
  // call fails; the sidecar re-sets it with a long maxAge.
  document.cookie = `${COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  const meta = document.querySelector('meta[name="theme-color"]:not([media*="light"])');
  meta?.setAttribute("content", theme === "dark" ? "#000000" : "#f4f6fb");
}

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);

  const setTheme = useCallback(async (next: Theme) => {
    applyTheme(next);
    emit();
    try {
      const token = csrfToken();
      await fetch("/api/auth/theme", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-csrf-token": token } : {}),
        },
        credentials: "same-origin",
        body: JSON.stringify({ theme: next }),
      });
    } catch {
      /* the cookie above is enough */
    }
  }, []);

  const toggle = useCallback(() => {
    void setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
