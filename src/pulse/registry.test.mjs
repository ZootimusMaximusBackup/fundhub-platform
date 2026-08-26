// Pulse registry coverage — same idea as src/http/routes.test.mjs.
// A new routed api/ handler or live public/app desk fails this until it is
// in PULSE_REGISTRY or ALLOWED_UNMONITORED with a written reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_UNMONITORED,
  PULSE_REGISTRY,
  checkRegistry,
  coverageKey,
  missingFromRegistry
} from "./registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, "../../api");
const APP_DIR = path.resolve(HERE, "../../public/app");

function handlerKeys(dir = API_DIR, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...handlerKeys(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) out.push(rel.slice(0, -".mjs".length));
  }
  return out;
}

function deskFiles() {
  return fs.readdirSync(APP_DIR).filter((name) => name.endsWith(".html")).sort();
}

const KEYS = handlerKeys();
const DESKS = deskFiles();

test("registry: every routed api/ handler and live public/app desk is listed or explicitly unmonitored", () => {
  const missing = missingFromRegistry({
    handlerKeys: KEYS,
    deskFiles: DESKS
  });
  assert.deepEqual(
    missing,
    [],
    `live paths missing from the pulse registry:\n  ${missing.join("\n  ")}\n` +
    `Add each to PULSE_REGISTRY in src/pulse/registry.mjs, or to ALLOWED_UNMONITORED ` +
    `with a written reason (same change as the feature).`
  );
});

test("registry: omitting a known live route fails coverage", () => {
  const truncated = PULSE_REGISTRY.filter((row) => coverageKey(row) !== "health");
  const missing = missingFromRegistry({
    handlerKeys: KEYS,
    deskFiles: DESKS,
    registry: truncated
  });
  assert.ok(
    missing.includes("health"),
    `expected omitting /api/health to fail coverage, got: ${missing.join(", ") || "(empty)"}`
  );
});

test("registry: no ALLOWED_UNMONITORED entry is stale", () => {
  const live = new Set([...KEYS, ...DESKS]);
  const covered = new Set(PULSE_REGISTRY.map(coverageKey));
  for (const key of Object.keys(ALLOWED_UNMONITORED)) {
    assert.ok(live.has(key), `ALLOWED_UNMONITORED names "${key}" but that file is gone — drop the entry.`);
    assert.ok(!covered.has(key), `"${key}" is in the registry and in ALLOWED_UNMONITORED. Pick one.`);
  }
});

test("registry: every ALLOWED_UNMONITORED entry carries a written reason", () => {
  for (const [key, reason] of Object.entries(ALLOWED_UNMONITORED)) {
    assert.ok(
      typeof reason === "string" && reason.trim().length >= 40,
      `ALLOWED_UNMONITORED["${key}"] needs a written reason, not "${reason}".`
    );
  }
});

test("registry: every registry row names a real handler or desk file", () => {
  const live = new Set([...KEYS, ...DESKS]);
  for (const row of PULSE_REGISTRY) {
    const key = coverageKey(row);
    assert.ok(live.has(key), `PULSE_REGISTRY has "${key}" (${row.path}) but that file is gone.`);
  }
});

test("registry: a GET ping writes up or down and never auto-fixes", async () => {
  const rows = [
    ...PULSE_REGISTRY.filter((row) => row.id === "health" || row.id === "pipeline"),
    { id: "public/unsubscribe", kind: "api", path: "/api/public/unsubscribe" }
  ];
  const checks = await checkRegistry({
    rows,
    baseUrl: "https://fundhub.ai",
    fetchImpl: async (url) => {
      if (String(url).includes("/api/health")) return { status: 200 };
      if (String(url).includes("/app/pipeline.html")) return { status: 503 };
      if (String(url).includes("/api/public/unsubscribe")) return { status: 400 };
      return { status: 404 };
    }
  });
  const health = checks.find((c) => c.id === "reg:health");
  const pipeline = checks.find((c) => c.id === "reg:pipeline");
  const unsub = checks.find((c) => c.id === "reg:public/unsubscribe");
  assert.equal(health.status, "up");
  assert.equal(unsub.status, "up");
  assert.equal(pipeline.status, "down");
  assert.match(pipeline.suggestedFix, /Do not auto-fix/);
  assert.ok(checks.every((c) => c.kind === "registry"));
});
