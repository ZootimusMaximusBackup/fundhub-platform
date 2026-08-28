import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Workflows that exist on disk and are deliberately NOT served.
 *
 * THE POINT OF THIS LIST IS THAT IT IS A LIST. The previous way to switch a
 * workflow off was to leave it out of index.mjs's import block, which is
 * invisible: nothing counted the files, the Automations screen showed the
 * registered set as if it were the whole set, and "53 written / 51 served" was
 * only discoverable by hand. Two jobs sat unserved that way for months — the
 * incomplete-survey nudge, while 400 stalled applications went unchased, and
 * the inquiry call sweeper. Both were switched on by the owner on 2026-08-19.
 *
 * An entry here needs a reason and an owner. An empty list is the healthy state. */
const DELIBERATELY_UNSERVED = {
  // "some-workflow-id": "why, and who decided",
};

/* Every id passed to inngest.createFunction in this directory, read from the
   source rather than by importing — importing every module to count them would
   run each one's module-scope side effects just to answer "does it exist". */
function idsOnDisk() {
  const found = new Map();
  for (const file of fs.readdirSync(HERE)) {
    if (!file.endsWith(".mjs") || file.endsWith(".test.mjs")) continue;
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    // Strip comments so a createFunction described in prose is not counted.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const re = /inngest\.createFunction\(\s*\{[^}]*?\bid:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(code))) found.set(m[1], file);
  }
  return found;
}

test("every workflow written on disk is either served or explicitly unserved", async () => {
  const { functions } = await import("./index.mjs");
  const registered = new Set(functions.map((fn) => fn.id()));
  const disk = idsOnDisk();

  const missing = [...disk.keys()]
    .filter((id) => !registered.has(id) && !(id in DELIBERATELY_UNSERVED))
    .map((id) => `${id} (${disk.get(id)})`);

  assert.deepEqual(missing, [],
    "these workflows are written but nothing serves them, so they can never run. " +
    "Either add them to index.mjs's `functions` array, or add them to " +
    "DELIBERATELY_UNSERVED in this file with a reason:\n  " + missing.join("\n  "));
});

test("nothing is listed as unserved that is actually served, or that no longer exists", () => {
  const disk = idsOnDisk();
  for (const [id, reason] of Object.entries(DELIBERATELY_UNSERVED)) {
    assert.ok(disk.has(id), `DELIBERATELY_UNSERVED names "${id}", which is not on disk any more — drop the line`);
    assert.ok(typeof reason === "string" && reason.trim().length > 0, `"${id}" needs a reason`);
  }
});

test("index serves exactly the workflows on disk, and the count is pinned", async () => {
  const { functions } = await import("./index.mjs");
  const disk = idsOnDisk();
  const expected = disk.size - Object.keys(DELIBERATELY_UNSERVED).length;

  /* 65 since the 2026-08-27 merge brought in two that were each added on their own
     branch and never counted here: daily-pulse (a 7:00 a.m. Denver audit-only
     sweep, acfa8bc9) and af-01-affiliate-drip (the existing AF1 affiliate welcome,
     bc05c169). Both are real registrations, so the pin moves rather than the code.
     Was 63 since Meet transcript sweeper (2026-08-24). Was 62 since S-04C staff booked-call text (2026-08-23). Was 61 since section 4
     (welcome, portal-invite, offer-bucket, doc-collection, ar-collections). Was 56
     since ghl-doc-document-check (section 2.2). Was 55 after
     repair-bureau-response-reader (WS-C). Was 54 after AI-SET-01 Josh setter was
     registered (2026-08-21). Was 53 after the incomplete-survey nudge and the
     inquiry call sweeper were switched on (2026-08-19).

     The count stays pinned as well as derived: registering a function is how a
     job starts running, and Inngest executes functions in production today, so
     it should cost somebody a line in a test. */
  assert.equal(functions.length, 65, `expected 65, got ${functions.length}`);
  assert.equal(functions.length, expected,
    `${disk.size} workflows on disk, ${Object.keys(DELIBERATELY_UNSERVED).length} deliberately unserved, ` +
    `so ${expected} should be served — but ${functions.length} are`);

  const ids = functions.map((fn) => fn.id());
  assert.equal(new Set(ids).size, ids.length, "a workflow is registered twice");
  for (const id of ids) {
    assert.ok(disk.has(id), `"${id}" is served but no file in this directory defines it`);
  }
  for (const fn of functions) {
    assert.ok(fn && typeof fn === "object", "each entry should be an Inngest function object");
  }
});

test("api/inngest serve endpoint imports without throwing", async () => {
  // Dynamic import of the serve handler — if the module graph is broken this throws.
  const mod = await import("../../api/inngest.mjs");
  assert.ok(mod.default, "serve handler should be the default export");
  assert.equal(typeof mod.default, "function", "serve handler should be a function");
});

/* ── EMITTER MANIFEST STALENESS ────────────────────────────────────────────
 *
 * api/read/workflows.mjs carries a hand-written map of "what actually causes
 * this event to be emitted". It is hand-written on purpose: nearly every real
 * emitter calls emit(db, c.name, ...) with the name resolved from a lookup
 * table a hundred lines earlier, so a grep for the event-name literal finds
 * nothing and a grep-based guard would report working funding events as
 * having no emitter at all.
 *
 * A hand-written map goes stale silently. These tests are what stops it: add a
 * workflow that listens to a new event and the first one fails until somebody
 * writes down how that event gets emitted and what gates it.
 *
 * The manifest is imported from an exported const, so none of this needs a
 * database or an HTTP request. */

test("every event a registered workflow listens for is in the emitter manifest", async () => {
  const { functions } = await import("./index.mjs");
  const { EVENT_EMITTERS } = await import("../../api/read/workflows.mjs");

  const listened = new Set();
  for (const fn of functions) {
    for (const t of (fn.opts && fn.opts.triggers) || []) {
      if (t.event) listened.add(t.event);
    }
  }

  const undocumented = [...listened].filter((ev) => !(ev in EVENT_EMITTERS)).sort();
  assert.deepEqual(undocumented, [],
    "these events start a workflow but nothing says how they are emitted. Add each one to " +
    "EVENT_EMITTERS in api/read/workflows.mjs, naming the code path and the environment " +
    "variable that gates it (or null when nothing gates it):\n  " + undocumented.join("\n  "));
});

test("the emitter manifest names no event that nothing listens for", async () => {
  const { functions } = await import("./index.mjs");
  const { EVENT_EMITTERS } = await import("../../api/read/workflows.mjs");

  const listened = new Set();
  for (const fn of functions) {
    for (const t of (fn.opts && fn.opts.triggers) || []) {
      if (t.event) listened.add(t.event);
    }
  }

  const orphaned = Object.keys(EVENT_EMITTERS).filter((ev) => !listened.has(ev)).sort();
  assert.deepEqual(orphaned, [],
    "the manifest documents these events, but no registered workflow triggers on them any " +
    "more. Either a workflow was unregistered without anyone noticing, or the lines are dead " +
    "and should go:\n  " + orphaned.join("\n  "));
});

test("every manifest entry is filled in, not stubbed", async () => {
  const { EVENT_EMITTERS, EMITTER_MANIFEST_VERIFIED_ON } =
    await import("../../api/read/workflows.mjs");

  assert.match(EMITTER_MANIFEST_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/,
    "the manifest needs a date recording when a human last checked it");

  for (const [event, entry] of Object.entries(EVENT_EMITTERS)) {
    assert.ok(entry && Array.isArray(entry.emitters),
      `"${event}" needs an emitters array — an EMPTY array is a legitimate answer and means ` +
      `nothing can emit it, but the key has to be there`);
    for (const em of entry.emitters) {
      assert.ok(typeof em.how === "string" && em.how.trim().length > 10,
        `"${event}" has an emitter with no plain-language description of how it fires`);
      assert.ok(em.gate === null || (typeof em.gate === "string" && em.gate.length > 0),
        `"${event}" has an emitter whose gate is neither an env-var name nor an explicit null. ` +
        `null means "nothing gates this"; leaving it undefined means "nobody checked"`);
    }
    assert.ok(entry.note === null || typeof entry.note === "string",
      `"${event}" note should be a string or an explicit null`);
  }
});

/* ── THE STATUS VALUES THE AUTOMATIONS SCREEN SHOWS ────────────────────────
 *
 * Guarding the two lies these statuses replaced. status "live" used to mean
 * only "a row exists in the events table", which auditors moved from 44 to 49
 * by firing five test events — nothing ran. And the cron-only jobs were
 * labelled never_triggered forever, because a clock job does not write an
 * event row. That was audit item T6-04. */

test("a cron-only workflow is scheduled, never 'never triggered'", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  assert.equal(
    statusOf({ events: [], crons: ["*/5 * * * *"], emitters: [], lastTriggeredAt: null }),
    "scheduled");
});

test("every cron-only workflow on the registry reports as scheduled", async () => {
  const { functions } = await import("./index.mjs");
  const { statusOf } = await import("../../api/read/workflows.mjs");

  let cronOnly = 0;
  for (const fn of functions) {
    const triggers = (fn.opts && fn.opts.triggers) || [];
    const events = triggers.map((t) => t.event).filter(Boolean);
    const crons = triggers.map((t) => t.cron).filter(Boolean);
    if (events.length || !crons.length) continue;
    cronOnly++;
    assert.equal(statusOf({ events, crons, emitters: [], lastTriggeredAt: null }), "scheduled",
      `"${fn.opts.id}" runs on a clock and must never be shown to the owner as dead`);
  }
  assert.ok(cronOnly >= 1, "expected at least one cron-only workflow in the registry");
});

test("an event row is reported as 'trigger seen', which is not a claim the workflow ran", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  const emitters = [{ event: "entry.captured", how: "the public survey form", gate: null, gate_set: null }];
  assert.equal(statusOf({ events: ["entry.captured"], crons: [], emitters, lastTriggeredAt: "2026-08-18T00:00:00Z" }),
    "trigger_seen");
  assert.equal(statusOf({ events: ["entry.captured"], crons: [], emitters, lastTriggeredAt: null }),
    "trigger_never_seen");
});

test("a workflow whose events nothing emits reports no_emitter", async () => {
  const { statusOf } = await import("../../api/read/workflows.mjs");
  const emitters = [{ event: "made.up", how: null, gate: null, gate_set: null }];
  assert.equal(statusOf({ events: ["made.up"], crons: [], emitters, lastTriggeredAt: null }), "no_emitter");
  assert.equal(statusOf({ events: [], crons: [], emitters: [], lastTriggeredAt: null }), "no_emitter");
});

test("registryRows honours limit and offset", async () => {
  const { registryRows } = await import("../../api/read/workflows.mjs");

  const all = registryRows();
  assert.ok(all.length > 5, "expected the whole registry when no page is asked for");

  /* Every list endpoint in this repo returns one row more than asked for, so
     page() in src/http/read-api.mjs can set hasMore without a count query. */
  const first = registryRows({ limit: 3, offset: 0 });
  assert.equal(first.length, 4, "should return limit + 1 rows");
  assert.deepEqual(first.slice(0, 3).map((r) => r.id), all.slice(0, 3).map((r) => r.id));

  const second = registryRows({ limit: 3, offset: 3 });
  assert.deepEqual(second.slice(0, 3).map((r) => r.id), all.slice(3, 6).map((r) => r.id));

  const past = registryRows({ limit: 3, offset: all.length + 10 });
  assert.deepEqual(past, [], "an offset past the end returns nothing, not everything");
});

test("cron expressions are turned into words the owner can read", async () => {
  const { cronInPlainWords } = await import("../../api/read/workflows.mjs");
  assert.equal(cronInPlainWords("*/5 * * * *"), "every 5 minutes");
  assert.equal(cronInPlainWords("*/15 * * * *"), "every 15 minutes");
  assert.equal(cronInPlainWords("0 10 * * *"), "once a day at 10:00 UTC");
  // Anything this helper has not been taught falls back to the raw expression.
  // A wrong schedule in confident English is worse than a right one in cron.
  assert.equal(cronInPlainWords("0 0 * * 1"), "0 0 * * 1");
});
