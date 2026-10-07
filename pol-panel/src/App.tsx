import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppRouter } from "@/router";
import { ToastViewport } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { sessionStore } from "@/lib/hooks/useSession";

const NAV_KEYS: Record<string, string> = {
  d: "/",
  m: "/models",
  p: "/playground",
  l: "/logs",
  c: "/config",
  a: "/admin",
};

const SHORTCUTS: Array<[string, string]> = [
  ["g then d", "Dashboard"],
  ["g then m", "Models"],
  ["g then p", "Playground"],
  ["g then l", "Logs"],
  ["g then c", "Config"],
  ["g then a", "Admin"],
  ["?", "This help"],
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export default function App() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void sessionStore.load();
  }, []);

  // Vim-style two-key navigation. Ignored while typing in a field.
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const disarm = () => {
      armed = false;
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === "Escape") {
        setHelpOpen(false);
        disarm();
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "g") {
        armed = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(disarm, 1200);
        return;
      }
      if (armed && NAV_KEYS[key]) {
        event.preventDefault();
        navigate(NAV_KEYS[key]);
        disarm();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      disarm();
    };
  }, [navigate]);

  return (
    <>
      <AppRouter />
      <ToastViewport />
      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts">
        <ul className="flex flex-col gap-1.5">
          {SHORTCUTS.map(([keys, description]) => (
            <li key={keys} className="flex items-center gap-2 text-sm">
              <Badge tone="neutral">
                <span className="font-mono">{keys}</span>
              </Badge>
              <span className="text-[var(--frost-muted)]">{description}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--frost-muted)]">
          On the Models page: <span className="font-mono">t</span> tests all models,{" "}
          <span className="font-mono">e</span> enables every disabled model,{" "}
          <span className="font-mono">x</span> disables every enabled model and{" "}
          <span className="font-mono">/</span> focuses the search box.
        </p>
      </Modal>
    </>
  );
}
