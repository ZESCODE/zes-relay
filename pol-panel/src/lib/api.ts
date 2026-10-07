/**
 * api.ts — the panel's HTTP client.
 *
 * Contract (BUILD-PROMPT §4.10):
 *   • status 200 + { ok: true, data }  -> resolve with `data`
 *   • status 200 + { ok: false, … }    -> throw (defensive; the relay never does this)
 *   • any non-200                      -> throw a typed ApiError, even if ok:true
 *   • a toggle that lands on "disabled" is a SUCCESS: read data.enabled.
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

/** The CSRF cookie is readable by JS on purpose; the session cookie is not. */
export function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)pp_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the CSRF header (used by the login call, before the cookie exists). */
  skipCsrf?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipCsrf, headers, ...init } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (!skipCsrf && method !== "GET" && method !== "HEAD") {
    const token = csrfToken();
    if (token) finalHeaders["x-csrf-token"] = token;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      method,
      headers: finalHeaders,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(
      "network",
      (error as Error)?.message === "Failed to fetch"
        ? "Cannot reach the panel sidecar. Is `npm run dev` / `npm start` running?"
        : String((error as Error)?.message || error),
      0,
    );
  }

  const text = await response.text();
  let parsed: Envelope | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as Envelope;
    } catch {
      parsed = null;
    }
  }

  if (response.status === 200) {
    if (!parsed || parsed.ok !== true) {
      throw new ApiError(
        parsed?.error?.code ?? "bad_envelope",
        parsed?.error?.message ?? `expected {ok:true} envelope from ${path}`,
        200,
        parsed,
      );
    }
    return parsed.data as T;
  }

  throw new ApiError(
    parsed?.error?.code ?? `http_${response.status}`,
    parsed?.error?.message ?? `HTTP ${response.status} from ${path}`,
    response.status,
    parsed?.error ? undefined : text.slice(0, 500),
  );
}

export const Api = {
  get: <T>(path: string, init?: RequestOptions) => api<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
    api<T>(path, { ...init, method: "POST", body: body ?? {} }),
  delete: <T>(path: string, init?: RequestOptions) => api<T>(path, { ...init, method: "DELETE" }),
};

/** Message for a thrown error, with the relay's own wording preferred. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
