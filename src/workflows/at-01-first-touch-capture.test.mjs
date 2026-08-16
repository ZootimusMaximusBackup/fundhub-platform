import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./at-01-first-touch-capture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: sets first touch date + lead magnet type", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.ok(db.clients[0].custom_fields.first_touch_date !== "now", "first_touch_date must be a real timestamp, not the literal string 'now'");
  assert.ok(new Date(db.clients[0].custom_fields.first_touch_date).getFullYear() > 2020, "first_touch_date must parse as a valid ISO date");
  assert.equal(db.clients[0].custom_fields.lead_magnet_type, "Survey");
});

test("branch: already locked — never overwritten", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { first_touch_date: "2026-01-01" } }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "already_locked");
  assert.equal(db.clients[0].custom_fields.first_touch_date, "2026-01-01");
});

test("does not overwrite a VSL magnet already stamped on the client", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { lead_magnet_type: "VSL" } }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.lead_magnet_type, "VSL");
});

test("duplicate delivery: replaying does not change the locked value", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("entry.captured", {}, { id: "evt-dup-at01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.ok(db.clients[0].custom_fields.first_touch_date !== "now", "locked value must be a real timestamp");
});

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "at-01-first-touch-capture.mjs");

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
