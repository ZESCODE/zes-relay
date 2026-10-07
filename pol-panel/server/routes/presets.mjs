/**
 * routes/presets.mjs — playground presets persisted as data/presets/<id>.json.
 * (Added on top of the spec's route list: the Playground's save/load feature
 * needs a home, and keeping it out of admin.mjs keeps both files readable.)
 */
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { ok, fail } from "../envelope.mjs";
import { PATHS, readJson, writeJsonAtomic } from "../fs-paths.mjs";

function safeId(id) {
  const clean = String(id || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  if (!clean || clean === "." || clean === ".." || clean.includes("..")) return null;
  return clean;
}

function presetPath(id) {
  return path.join(PATHS.presetsDir, `${id}.json`);
}

export default function presetRoutes({ log }) {
  const router = Router();

  router.get("/", (req, res) => {
    const presets = fs
      .readdirSync(PATHS.presetsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(PATHS.presetsDir, f), null))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return ok(res, { presets });
  });

  router.get("/:id", (req, res) => {
    const id = safeId(req.params.id);
    if (!id) return fail(res, 400, "bad_request", "invalid preset id");
    const preset = readJson(presetPath(id), null);
    if (!preset) return fail(res, 404, "not_found", `preset ${id} not found`);
    return ok(res, preset);
  });

  router.post("/", (req, res) => {
    const body = req.body || {};
    const id = safeId(body.id || `preset-${Date.now().toString(36)}`);
    if (!id) return fail(res, 400, "bad_request", "invalid preset id");
    const preset = {
      id,
      name: String(body.name || id).slice(0, 80),
      model: String(body.model || ""),
      messages: Array.isArray(body.messages) ? body.messages : [],
      params: body.params && typeof body.params === "object" ? body.params : {},
      updatedAt: Date.now(),
    };
    writeJsonAtomic(presetPath(id), preset);
    log?.push?.({ level: "info", source: "panel", message: `[presets] saved ${id}` });
    return ok(res, preset);
  });

  router.delete("/:id", (req, res) => {
    const id = safeId(req.params.id);
    if (!id) return fail(res, 400, "bad_request", "invalid preset id");
    const file = presetPath(id);
    if (!fs.existsSync(file)) return fail(res, 404, "not_found", `preset ${id} not found`);
    fs.unlinkSync(file);
    return ok(res, { deleted: id });
  });

  return router;
}
