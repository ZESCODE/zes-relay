/**
 * useSession.ts — who is signed in, plus login/logout for the whole app.
 * An external store (like the toast store) so any module can react to a
 * session change without prop drilling.
 */
import { useSyncExternalStore } from "react";
import { Api, errorMessage } from "../api";

export interface SessionUser {
  username: string;
  role: string;
  kind: "session" | "token";
}

export interface SessionState {
  user: SessionUser | null;
  csrf: string | null;
  loading: boolean;
  error: string | null;
}

type Listener = () => void;

const INITIAL: SessionState = { user: null, csrf: null, loading: true, error: null };

class SessionStore {
  private state: SessionState = INITIAL;
  private listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getState = (): SessionState => this.state;

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  async load(force = false): Promise<SessionState> {
    if (!force && !this.state.loading && this.state.user) return this.state;
    if (!force && this.loading) {
      await this.loading;
      return this.state;
    }
    this.set({ loading: true });
    this.loading = (async () => {
      try {
        const data = await Api.get<{ user: SessionUser | null; csrf: string | null }>("/api/auth/me");
        this.set({ user: data.user, csrf: data.csrf, loading: false, error: null });
      } catch (error) {
        this.set({ user: null, loading: false, error: errorMessage(error) });
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
    return this.state;
  }

  async login(username: string, password: string): Promise<boolean> {
    this.set({ error: null });
    try {
      const data = await Api.post<{ user: SessionUser; csrf: string }>(
        "/api/auth/login",
        { username, password },
        { skipCsrf: true },
      );
      this.set({ user: data.user, csrf: data.csrf, error: null });
      return true;
    } catch (error) {
      this.set({ error: errorMessage(error) });
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await Api.post("/api/auth/logout");
    } catch {
      /* the cookie is cleared server-side either way */
    }
    this.set({ user: null, csrf: null });
  }

  setCsrf(csrf: string) {
    this.set({ csrf });
  }
}

export const sessionStore = new SessionStore();

export interface UseSessionResult extends SessionState {
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  reload: () => Promise<SessionState>;
}

export function useSession(): UseSessionResult {
  const state = useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
  return {
    ...state,
    login: (username, password) => sessionStore.login(username, password),
    logout: () => sessionStore.logout(),
    reload: () => sessionStore.load(true),
  };
}
