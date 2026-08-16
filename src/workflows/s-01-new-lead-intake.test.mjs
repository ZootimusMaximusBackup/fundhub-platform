import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./s-01-new-lead-intake.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "s-01-new-lead-intake.mjs");

const SALES_STAGES = [
  { org_id: "org-1", pipeline_key: "sales", stage_key: "new_lead",
    pipeline_id: "pipe-sales", stage_id: "stage-new-lead", sort_order: 0 }
];

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`S-01 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: entry.captured sets lifecycle status + lead:new tag and a board card", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    pipelineStages: SALES_STAGES
  });
  const res = await handle({
    event: ev("entry.captured", {}, { clientId: "cl-1", orgId: "org-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "New Lead");
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
  assert.equal(db.cards.length, 1);
  assert.equal(db.cards[0].stage_id, "stage-new-lead");
  assert.equal(res.card && res.card.moved, true);
});

test("duplicate delivery: replaying does not duplicate the tag or the card", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    pipelineStages: SALES_STAGES
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-s01", clientId: "cl-1", orgId: "org-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
  assert.equal(db.cards.length, 1);
});

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], pipelineStages: SALES_STAGES });
    const res = await handle({
      event: ev("entry.captured", {}, { id: "evt-miss-s01" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
    assert.equal(db.cards.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const bad of [null, undefined, "entry.captured", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.clients.length, 0);
    assert.equal(db.cards.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate replay keeps one tag + one card, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      pipelineStages: SALES_STAGES
    });
    const event = ev("entry.captured", {}, { id: "evt-dup-smash-s01", clientId: "cl-1", orgId: "org-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.deepEqual(db.clients[0].tags, ["lead:new"]);
    assert.equal(db.cards.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bdrain(All)?\s*\(/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /outbox\.mjs/);
  assert.doesNotMatch(code, /vercel\.app/);
  assert.doesNotMatch(code, /bland/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
});
