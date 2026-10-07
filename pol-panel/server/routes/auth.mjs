/**
 * routes/auth.mjs — login, logout, session info, theme, password change.
 * Sessions are signed httpOnly cookies; there are no localStorage tokens.
 */
import { Router } from "express";
import {
  SESSION_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  signSession,
  newCsrfToken,
  sessionCookieOptions,
  checkCredentials,
  setPassword,
  requireCsrf,
} from "../auth.mjs";
import { ok, fail, clientIp } from "../envelope.mjs";
import { rateLimit } from "../rate-limit.mjs";

export default function authRoutes({ log, secureFor = () => false }) {
  const router = Router();
  const sessionHours = Number(process.env.PANEL_SESSION_HOURS || 72);
  const loginRpm = Number(process.env.PANEL_LOGIN_RPM || 5);

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: loginRpm,
    name: "login",
    key: (req) => clientIp(req),
  });

  router.post("/login", loginLimiter, (req, res) => {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!username || !password) {
      return fail(res, 400, "bad_request", "username and password are required");
    }
    const user = checkCredentials(username, password);
    if (!user) {
      log.push({ level: "warn", source: "auth", message: `failed login for "${username}" from ${clientIp(req)}` });
      return fail(res, 401, "invalid_credentials", "invalid username or password");
    }
    const token = signSession({ u: user.username, r: user.role }, { ttlHours: sessionHours });
    const csrf = newCsrfToken();
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions({ secure: secureFor(req), maxAgeHours: sessionHours }));
    res.cookie(CSRF_COOKIE, csrf, {
      httpOnly: false,
      sameSite: "lax",
      secure: secureFor(req),
      path: "/",
      maxAge: sessionHours * 3600 * 1000,
    });
    log.push({ level: "info", source: "auth", message: `login ok: ${user.username} from ${clientIp(req)}` });
    return ok(res, { user: { username: user.username, role: user.role }, csrf });
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(CSRF_COOKIE, { path: "/" });
    log.push({ level: "info", source: "auth", message: `logout: ${req.auth?.username ?? "anonymous"}` });
    return ok(res, { loggedOut: true });
  });

  router.get("/me", (req, res) => {
    if (!req.auth) return ok(res, { user: null, csrf: req.cookies?.[CSRF_COOKIE] ?? null });
    let csrf = req.cookies?.[CSRF_COOKIE];
    if (!csrf) {
      csrf = newCsrfToken();
      res.cookie(CSRF_COOKIE, csrf, {
        httpOnly: false,
        sameSite: "lax",
        secure: secureFor(req),
        path: "/",
        maxAge: sessionHours * 3600 * 1000,
      });
    }
    return ok(res, {
      user: { username: req.auth.username ?? req.auth.name, role: req.auth.role ?? "api", kind: req.auth.kind },
      csrf,
    });
  });

  router.post("/password", requireCsrf, (req, res) => {
    if (req.auth?.kind !== "session") {
      return fail(res, 403, "session_required", "password change requires a session login");
    }
    const current = String(req.body?.current ?? "");
    const next = String(req.body?.next ?? "");
    if (next.length < 8) return fail(res, 400, "weak_password", "password must be at least 8 characters");
    if (!checkCredentials(req.auth.username, current)) {
      return fail(res, 401, "invalid_credentials", "current password is incorrect");
    }
    const result = setPassword(req.auth.username, next);
    if (!result.ok) return fail(res, 404, result.code, result.message);
    log.push({ level: "warn", source: "auth", message: `password changed for ${req.auth.username}` });
    return ok(res, { changed: true });
  });

  /** Theme lives in a readable cookie so the pre-paint script can apply it. */
  router.post("/theme", (req, res) => {
    const theme = req.body?.theme === "light" ? "light" : "dark";
    res.cookie("pp_theme", theme, {
      httpOnly: false,
      sameSite: "lax",
      secure: secureFor(req),
      path: "/",
      maxAge: 365 * 24 * 3600 * 1000,
    });
    return ok(res, { theme });
  });

  router.get("/csrf", (req, res) => {
    let csrf = req.cookies?.[CSRF_COOKIE];
    if (!csrf) {
      csrf = newCsrfToken();
      res.cookie(CSRF_COOKIE, csrf, {
        httpOnly: false,
        sameSite: "lax",
        secure: secureFor(req),
        path: "/",
        maxAge: sessionHours * 3600 * 1000,
      });
    }
    return ok(res, { csrf, header: CSRF_HEADER });
  });

  return router;
}
