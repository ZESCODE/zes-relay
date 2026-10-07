/**
 * useToast.ts — a tiny external store for toasts.
 *
 * Deliberately not a context provider: any module (including the model store)
 * can raise a toast without being inside a React tree. The visual viewport
 * lives in components/ui/Toast.tsx and is mounted once by App.
 */
import { useCallback, useSyncExternalStore } from "react";
import { newId } from "../format";

export type ToastTone = "success" | "error" | "warn" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  ttl: number;
  createdAt: number;
}

type Listener = () => void;

const MAX_TOASTS = 4;

class ToastStore {
  private items: Toast[] = [];
  private listeners = new Set<Listener>();

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): Toast[] => this.items;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  push(tone: ToastTone, title: string, message?: string, ttl = tone === "error" ? 7000 : 4000): string {
    const toast: Toast = { id: newId("toast"), tone, title, message, ttl, createdAt: Date.now() };
    this.items = [...this.items.slice(-(MAX_TOASTS - 1)), toast];
    this.emit();
    if (ttl > 0) {
      const timer = setTimeout(() => this.dismiss(toast.id), ttl);
      // Never keep the event loop alive just for a toast.
      (timer as unknown as { unref?: () => void }).unref?.();
    }
    return toast.id;
  }

  dismiss = (id: string): void => {
    this.items = this.items.filter((t) => t.id !== id);
    this.emit();
  };

  clear = (): void => {
    this.items = [];
    this.emit();
  };

  success = (title: string, message?: string) => this.push("success", title, message);
  error = (title: string, message?: string) => this.push("error", title, message);
  warn = (title: string, message?: string) => this.push("warn", title, message);
  info = (title: string, message?: string) => this.push("info", title, message);
}

export const toastStore = new ToastStore();

export interface UseToastResult {
  toasts: Toast[];
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warn: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  dismiss: (id: string) => void;
}

export function useToast(): UseToastResult {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
  const dismiss = useCallback((id: string) => toastStore.dismiss(id), []);
  return {
    toasts,
    dismiss,
    success: (title, message) => toastStore.success(title, message),
    error: (title, message) => toastStore.error(title, message),
    warn: (title, message) => toastStore.warn(title, message),
    info: (title, message) => toastStore.info(title, message),
  };
}
