import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./af-02-referral-ownership-capture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "af-02-referral-ownership-capture.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`AF-02 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: first touch with a1 locks tier1 ownership", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("entry.captured", { a1: "aff-123" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.affiliate_tier1_owner, "aff-123");
});

test("branch: ownership already locked — never overwritten", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { first_touch_date: "2026-01-01", affiliate_tier1_owner: "aff-original" } }] });
  const res = await handle({ event: ev("analysis.completed", { a1: "aff-new-attempt" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "ownership_already_locked");
  assert.equal(db.clients[0].custom_fields.affiliate_tier1_owner, "aff-original");
});

test("branch: no referral param present — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_referral_param");
});

test("duplicate delivery: replaying the same event does not re-lock or change ownership", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev("entry.captured", { a1: "aff-123" }, { id: "evt-dup-af02", clientId: "cl-1" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.equal(db.clients[0].custom_fields.affiliate_tier1_owner, "aff-123");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("entry.captured", { a1: "aff-123" }, { id: "evt-miss-af02" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
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
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate replay keeps one owner lock, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev("entry.captured", { a1: "aff-123", a2: "aff-tier2" }, { id: "evt-dup-smash-af02", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.patch.affiliate_tier1_owner, "aff-123");
    assert.equal(second.done, false);
    assert.equal(second.reason, "ownership_already_locked");
    assert.equal(db.clients[0].custom_fields.affiliate_tier1_owner, "aff-123");
    assert.equal(db.clients[0].custom_fields.affiliate_tier2_owner, "aff-tier2");
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
