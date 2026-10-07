/**
 * token-store.mjs — optional API tokens for /api/* (Authorization: Bearer …).
 *
 * The plaintext token is shown exactly once at creation time. Only an
 * HMAC-SHA256 digest is persisted, and comparisons use crypto.timingSafeEqual.
 */
import crypto from "node:crypto";
import { PATHS, readJson, writeJsonAtomic } from "./fs-paths.mjs";
import { getSecrets } from "./auth.mjs";

export class TokenStore {
  constructor({ file = PATHS.tokensFile } = {}) {
    this.file = file;
    this.state = readJson(this.file, { tokens: [] });
    if (!Array.isArray(this.state.tokens)) this.state.tokens = [];
    this._saveScheduled = false;
  }

  #digest(raw) {
    return crypto
      .createHmac("sha256", getSecrets().tokenSecret)
      .update(raw)
      .digest("hex");
  }

  #save() {
    writeJsonAtomic(this.file, this.state);
  }

  /** Debounced persistence for lastUsedAt updates. */
  #touchSave() {
    if (this._saveScheduled) return;
    this._saveScheduled = true;
    setTimeout(() => {
      this._saveScheduled = false;
      this.#save();
    }, 2000).unref?.();
  }

  list() {
    return this.state.tokens.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt ?? null,
      lastUsedIp: t.lastUsedIp ?? null,
      useCount: t.useCount ?? 0,
    }));
  }

  create(name, { ip = null } = {}) {
    const raw = `pp_${crypto.randomBytes(24).toString("base64url")}`;
    const record = {
      id: crypto.randomUUID(),
      name: String(name || "token").slice(0, 64),
      prefix: raw.slice(0, 8),
      hmac: this.#digest(raw),
      createdAt: Date.now(),
      lastUsedAt: null,
      lastUsedIp: ip,
      useCount: 0,
    };
    this.state.tokens.push(record);
    this.#save();
    return { id: record.id, name: record.name, token: raw, prefix: record.prefix, createdAt: record.createdAt };
  }

  /** @returns the stored record (without the digest) or null. */
  verify(raw) {
    if (typeof raw !== "string" || !raw.startsWith("pp_")) return null;
    const digest = this.#digest(raw);
    const needle = Buffer.from(digest, "hex");
    for (const token of this.state.tokens) {
      const candidate = Buffer.from(token.hmac, "hex");
      if (candidate.length === needle.length && crypto.timingSafeEqual(candidate, needle)) {
        token.lastUsedAt = Date.now();
        token.useCount = (token.useCount || 0) + 1;
        this.#touchSave();
        return { id: token.id, name: token.name, prefix: token.prefix };
      }
    }
    return null;
  }

  markIp(id, ip) {
    const token = this.state.tokens.find((t) => t.id === id);
    if (token) {
      token.lastUsedIp = ip;
      this.#touchSave();
    }
  }

  revoke(id) {
    const before = this.state.tokens.length;
    this.state.tokens = this.state.tokens.filter((t) => t.id !== id);
    if (this.state.tokens.length === before) {
      return { ok: false, code: "not_found", message: `token ${id} not found` };
    }
    this.#save();
    return { ok: true, id };
  }

  count() {
    return this.state.tokens.length;
  }
}

export function getTokenStore(opts) {
  if (!globalThis.__polPanelTokens) globalThis.__polPanelTokens = new TokenStore(opts);
  return globalThis.__polPanelTokens;
}
