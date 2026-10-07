import { cn } from "@/lib/format";
import { useToast } from "@/lib/hooks/useToast";
import type { ToastTone } from "@/lib/hooks/useToast";

const TONE_STYLES: Record<ToastTone, string> = {
  success: "frost-green",
  error: "frost-red",
  warn: "frost-orange",
  info: "frost-blue",
};

const TONE_ICON: Record<ToastTone, string> = {
  success: "✓",
  error: "✕",
  warn: "!",
  info: "i",
};

/**
 * Single toast viewport for the whole app. Announced politely so screen
 * readers hear failures without stealing focus from the switch you just hit.
 */
export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3",
        // clear the mobile tab bar + home indicator
        "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-4 sm:items-end sm:right-4 sm:left-auto",
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "pointer-events-auto w-full sm:w-96 rounded-xl p-3 animate-toast-in",
            "glass-strong backdrop-blur-xl",
            TONE_STYLES[toast.tone],
          )}
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black/25 text-xs font-bold"
            >
              {TONE_ICON[toast.tone]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold break-words">{toast.title}</p>
              {toast.message ? (
                <p className="mt-0.5 text-xs text-white/80 break-words">{toast.message}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded-md px-2 py-1 text-xs text-white/70 hover:text-white hover:bg-black/20"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
