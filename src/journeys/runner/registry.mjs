/* The workflow registry the runner drives.
 *
 * src/workflows/index.mjs exports `functions` — 47 Inngest function objects
 * and nothing else. That array is enough to learn WHAT exists and WHAT
 * triggers it (`fn.id()`, `fn.opts.triggers`), but not enough to run anything:
 *
 *   THE INNGEST WRAPPER CLOSES OVER THE REAL DATABASE POOL. Every workflow
 *   ends with
 *       ({ event, step }) => handle({ event: event.data, db, step })
 *   where `db` is the module-scope import from src/db.mjs. Calling `fn.fn(...)`
 *   would run the workflow against the live pool no matter what handle the
 *   runner was given — past any transaction the caller opened, past any fake.
 *
 * So the runner never calls `fn.fn`. It calls each module's exported
 * `handle({ event, db, step })` directly, which is the pure, injectable half
 * every one of the 47 files exposes for exactly this reason. This module is
 * what joins the two: triggers and id from the function object, the callable
 * from the module's own export.
 *
 * Cross-checked against `functions` on load, so a workflow that is registered
 * but unreadable — or readable but unregistered — is a loud failure rather
 * than a silently smaller coverage list.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { functions } from "../../workflows/index.mjs";

const WORKFLOW_DIR = path.join(process.cwd(), "src/workflows");

let cached = null;

/* load() → { workflows, byEvent, unrunnable }
 *
 *   workflows  — [{ id, name, triggers: [event], handle }]
 *   byEvent    — Map<eventName, [workflow]>
 *   unrunnable — registered functions whose module exports no `handle`
 */
export async function load() {
  if (cached) return cached;

  const files = (await fs.readdir(WORKFLOW_DIR))
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));

  // id → module, for every workflow module on disk.
  const byId = new Map();
  for (const file of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(WORKFLOW_DIR, file)).href);
    } catch {
      continue; // not importable in isolation; the cross-check below catches it
    }
    for (const value of Object.values(mod)) {
      if (value && typeof value === "object" && typeof value.id === "function" && value.opts?.triggers) {
        byId.set(value.id(), { mod, file });
      }
    }
  }

  const workflows = [];
  const unrunnable = [];
  for (const fn of functions) {
    const id = fn.id();
    const triggers = (fn.opts?.triggers || []).map((t) => t.event).filter(Boolean);
    const found = byId.get(id);
    if (!found || typeof found.mod.handle !== "function") {
      // Registered but not callable by the runner. Reported, never skipped —
      // a workflow quietly missing from the coverage list reads as "no journey
      // reaches it", which is a different and much more alarming finding.
      unrunnable.push({ id, name: fn.opts?.name || id, triggers, reason: found ? "module exports no handle()" : "module not found on disk" });
      continue;
    }
    workflows.push({ id, name: fn.opts?.name || id, triggers, file: found.file, handle: found.mod.handle });
  }

  const byEvent = new Map();
  for (const w of workflows) {
    for (const e of w.triggers) {
      if (!byEvent.has(e)) byEvent.set(e, []);
      byEvent.get(e).push(w);
    }
  }

  cached = { workflows, byEvent, unrunnable, registered: functions.length };
  return cached;
}

/* Every workflow that no journey reached. Each one is either dead code or a
   journey nobody authored — both are findings, neither is repaired here. */
export function neverFired(registry, firedIds) {
  const fired = new Set(firedIds);
  return registry.workflows
    .filter((w) => !fired.has(w.id))
    .map((w) => ({ id: w.id, name: w.name, triggers: w.triggers }));
}

export function _resetCache() {
  cached = null;
}
