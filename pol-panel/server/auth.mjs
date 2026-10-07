/**
 * auth.mjs — password hashing, signed httpOnly sessions, CSRF.
 *
 * No third-party crypto: Node's crypto.scrypt for passwords and HMAC-SHA256
 * signed compact session cookies. Nothing token-like is ever stored in
 * localStorage; the browser only ever holds httpOnly cookies (plus the
 * non-secret CSRF cookie that JS must be able to read).
 */
import crypto from "node:crypto";
import { PATHS, readJson, writeJsonAtomic, writeTextAtomic, ensureDataDirs } from "./fs-paths.mjs";

export const SESSION_COOKIE = "pp_sid";
export const CSRF_COOKIE = "pp_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

export function timingSafeCompare(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) {
    // Compare against itself so timing does not leak the length mismatch.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Server-side secrets (session signing key + token HMAC key). Created 0600. */
export function getSecrets() {
  if (globalThis.__polPanelSecrets) return globalThis.__polPanelSecrets;
  ensureDataDirs();
  let secrets = readJson(PATHS.secretsFile, null);
  if (!secrets || !secrets.sessionSecret || !secrets.tokenSecret) {
    secrets = {
      sessionSecret: process.env.PANEL_SESSION_SECRET || crypto.randomBytes(32).toString("base64url"),
      tokenSecret: crypto.randomBytes(32).toString("base64url"),
      createdAt: Date.now(),
    };
    writeJsonAtomic(PATHS.secretsFile, secrets);
  }
  globalThis.__polPanelSecrets = secrets;
  return secrets;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, hash] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64url");
    const actual = crypto.scryptSync(String(password), Buffer.from(salt, "base64url"), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sign(payloadB64) {
  return crypto
    .createHmac("sha256", getSecrets().sessionSecret)
    .update(payloadB64)
    .digest("base64url");
}

export function signSession(payload, { ttlHours = 72 } = {}) {
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlHours * 3600,
  };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifySession(cookieValue) {
  if (typeof cookieValue !== "string" || !cookieValue.includes(".")) return null;
  const [payloadB64, signature] = cookieValue.split(".");
  if (!payloadB64 || !signature) return null;
  if (!timingSafeCompare(sign(payloadB64), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions({ secure = false, maxAgeHours = 72 } = {}) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: maxAgeHours * 3600 * 1000,
  };
}

export function newCsrfToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Create the admin account on first run.
 * Credentials come from PANEL_ADMIN_USER / PANEL_ADMIN_PASSWORD, otherwise a
 * one-time password is generated, written to data/FIRST-RUN.txt (0600) and
 * printed to stderr.
 */
export function ensureAdmin(log) {
  ensureDataDirs();
  const users = readJson(PATHS.usersFile, { users: [] });
  if (Array.isArray(users.users) && users.users.length > 0) {
    return { created: false, user: users.users[0].username };
  }
  const username = process.env.PANEL_ADMIN_USER || "admin";
  const generated = !process.env.PANEL_ADMIN_PASSWORD;
  const password = process.env.PANEL_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
  users.users = [
    {
      username,
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      role: "admin",
    },
  ];
  writeJsonAtomic(PATHS.usersFile, users);

  if (generated) {
    writeTextAtomic(
      PATHS.firstRunFile,
      [
        "pol-panel first-run credentials",
        `created: ${new Date().toISOString()}`,
        `username: ${username}`,
        `password: ${password}`,
        "",
        "This file is mode 0600. Delete it after your first login.",
        "",
      ].join("\n"),
      0o600,
    );
    process.stderr.write(
      `\n[pol-panel] ── first-run credentials ─────────────────────────\n` +
        `[pol-panel]   user: ${username}\n` +
        `[pol-panel]   pass: ${password}\n` +
        `[pol-panel]   (also written to ${PATHS.firstRunFile})\n` +
        `[pol-panel] ─────────────────────────────────────────────────\n\n`,
    );
  }
  log?.info?.(`admin user "${username}" created${generated ? " with a generated password" : ""}`);
  return { created: true, user: username, generated };
}

export function checkCredentials(username, password) {
  const users = readJson(PATHS.usersFile, { users: [] });
  const found = (users.users || []).find((u) => u.username === username);
  if (!found) {
    // Hash a dummy password so a missing user costs the same time.
    verifyPassword(password, hashPassword("dummy-timing-equalizer"));
    return null;
  }
  return verifyPassword(password, found.passwordHash) ? { username: found.username, role: found.role } : null;
}

export function setPassword(username, password) {
  const users = readJson(PATHS.usersFile, { users: [] });
  const found = (users.users || []).find((u) => u.username === username);
  if (!found) return { ok: false, code: "not_found", message: "user not found" };
  found.passwordHash = hashPassword(password);
  found.updatedAt = Date.now();
  writeJsonAtomic(PATHS.usersFile, users);
  return { ok: true };
}

/**
 * Non-enforcing: populates req.auth when a valid session cookie or API token is
 * present, otherwise leaves it unset and continues. Mounted before /api/auth so
 * that GET /api/auth/me can answer "who am I" (including "nobody") instead of
 * 401-ing before the route ever runs.
 */
export function createAttachAuth({ tokens }) {
  return function attachAuth(req, _res, next) {
    const header = req.get("authorization") || "";
    if (header.toLowerCase().startsWith("bearer ")) {
      const token = tokens.verify(header.slice(7).trim());
      if (token) {
        tokens.markIp(token.id, req.ip);
        req.auth = { kind: "token", ...token };
        req.csrfOk = true; // bearer callers are not cookie-authenticated
      }
      return next();
    }
    const session = verifySession(req.cookies?.[SESSION_COOKIE]);
    if (session?.u) {
      req.auth = { kind: "session", username: session.u, role: session.r || "admin" };
    }
    next();
  };
}

/** Middleware: requires a session cookie OR a valid API bearer token. */
export function createRequireAuth({ tokens }) {
  const attach = createAttachAuth({ tokens });
  return function requireAuth(req, res, next) {
    attach(req, res, () => {
      if (req.auth) return next();
      const hasBearer = (req.get("authorization") || "").toLowerCase().startsWith("bearer ");
      return res.status(401).json({
        ok: false,
        error: {
          code: "unauthorized",
          message: hasBearer ? "invalid API token" : "not signed in",
        },
      });
    });
  };
}

/** Middleware: Origin check + double-submit CSRF token on state-changing routes. */
export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.csrfOk) return next(); // bearer-token callers are exempt

  const origin = req.get("origin");
  if (origin) {
    const host = req.get("host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = "";
    }
    if (originHost !== host) {
      return res.status(403).json({
        ok: false,
        error: { code: "csrf_origin", message: `Origin ${origin} does not match Host ${host}` },
      });
    }
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER) || req.body?.csrfToken;
  if (!cookieToken || !headerToken || !timingSafeCompare(cookieToken, headerToken)) {
    return res.status(403).json({
      ok: false,
      error: { code: "csrf", message: "missing or mismatched CSRF token" },
    });
  }
  next();
}
