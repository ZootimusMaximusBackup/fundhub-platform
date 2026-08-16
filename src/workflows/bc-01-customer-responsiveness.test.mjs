import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, RESPONSIVENESS } from "./bc-01-customer-responsiveness.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

// 05/30 doc 667-672 (GATE BC-01B) makes the two paths mutually exclusive, selected by
// Round Hold Reason on the CONTACT:
//   "Awaiting CRS" -> CRS-payment responsiveness (CRS Paid)
//   otherwise      -> docs responsiveness (docs:missing tag alone)

// --- CRS path ---------------------------------------------------------------

test("CRS path: hold is Awaiting CRS and CRS is paid -> Fast", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    custom_fields: { round_hold_reason: "Awaiting CRS", crs_paid: true } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "fast");
  assert.equal(db.behaviorScores[0].responsiveness, RESPONSIVENESS.fast);
});

test("CRS path: hold is Awaiting CRS and CRS unpaid after both waits -> Slow", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    custom_fields: { round_hold_reason: "Awaiting CRS" } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "slow");
});

test("CRS path: paying between the 24h and 48h checks -> Normal", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    custom_fields: { round_hold_reason: "Awaiting CRS" } }];
  const db = pgFake({ clients });
  let sleeps = 0;
  const step = { run: (_id, fn) => fn(), sleep: async () => { sleeps += 1; if (sleeps === 2) clients[0].custom_fields.crs_paid = true; } };
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step });
  assert.equal(res.responsiveness, "normal");
});

// --- docs path --------------------------------------------------------------

test("docs path: no docs:missing tag -> Fast", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [], custom_fields: {} }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "fast");
});

test("docs path: docs:missing still set after both waits -> Slow", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    tags: ["docs:missing"], custom_fields: {} }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "slow");
});

test("docs path: docs cleared between the 24h and 48h checks -> Normal", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["docs:missing"], custom_fields: {} }];
  const db = pgFake({ clients });
  let sleeps = 0;
  const step = { run: (_id, fn) => fn(), sleep: async () => { sleeps += 1; if (sleeps === 2) clients[0].tags = []; } };
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step });
  assert.equal(res.responsiveness, "normal");
});

// THE REGRESSION: crs_paid used to be checked FIRST on both paths. Every funding client
// pays the CRS diagnostic, so that short-circuit made the docs path unreachable and every
// funding client scored Fast regardless of whether they ever sent a document.
test("REGRESSION: a paid client still sitting on docs:missing scores Slow, not Fast", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    tags: ["docs:missing"], custom_fields: { crs_paid: true } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.responsiveness, "slow", "crs_paid must not short-circuit the docs path");
});

test("REGRESSION: the docs path ignores crs_paid entirely", async () => {
  const paid = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [], custom_fields: { crs_paid: true } }] });
  const unpaid = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [], custom_fields: {} }] });
  const a = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db: paid, step: fakeStep() });
  const b = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db: unpaid, step: fakeStep() });
  assert.equal(a.responsiveness, b.responsiveness, "CRS payment is irrelevant off the Awaiting CRS path");
});

// KNOWN GAP (logged in workflow-migration-table.md): behavior_scores has no
// idempotency hook in the current schema (no unique constraint, no jsonb column to
// stash an event id) — unlike every other handler in this directory, a replayed
// event here writes a second row instead of a no-op. Low-risk (analytics-only, not
// money/messaging/PII) but does not strictly satisfy Rule 2; would need a schema
// change (out of scope for this session) to fix properly. This test documents the
// gap rather than hiding it.
test("duplicate delivery: KNOWN GAP — replaying writes a second row (no idempotency hook available on behavior_scores)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com",
    custom_fields: { round_hold_reason: "Awaiting CRS", crs_paid: true } }] });
  const event = ev("round.started", {}, { id: "evt-dup-bc01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.behaviorScores.length, 2);
});

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "bc-01-customer-responsiveness.mjs");

test("smash: null / non-object event → no_event, no throw", async () => {
  const db = pgFake({ clients: [] });
  for (const event of [null, undefined, "nope", 7]) {
    const res = await handle({ event, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
  }
  assert.equal(db.messages.length, 0);
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SMASH_SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /vercel\.app/);
});
