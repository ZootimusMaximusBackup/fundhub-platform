import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./s-04-call-booked.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withStage = () => ({
  pipelineStages: [{
    org_id: "org-1",
    pipeline_key: "sales",
    stage_key: "booked",
    pipeline_id: "pl-sales",
    stage_id: "st-booked",
    sort_order: 2
  }]
});

test("happy path: booking.created tags, sets outcome, moves the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStage() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "booked");
  assert.equal(db.cards[0].stage_id, "st-booked");
});

test("duplicate delivery: replaying does not duplicate the card or tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStage() });
  const event = ev("booking.created", {}, { id: "evt-dup-s04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.cards.length, 1);
  assert.deepEqual(db.clients[0].tags, ["call:booked"]);
});

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "s-04-call-booked.mjs");

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
