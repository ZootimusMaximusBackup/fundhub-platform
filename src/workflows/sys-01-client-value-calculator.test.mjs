import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./sys-01-client-value-calculator.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "sys-01-client-value-calculator.mjs");

const client = () => [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }];

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`SYS-01 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: approved amount * fee percent is the commission estimate", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { approvedAmount: 20000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialCommission, 2000);
  assert.equal(db.clients[0].custom_fields.potential_commission, 2000);
});

// REGRESSION (05/30 doc 3704-3711): the fallback branch used to return the raw funding
// estimate with no fee multiplication, overstating client value by ~10x at a typical 10%
// fee. The doc applies "Multiply by Funding Fee Percent" on BOTH branches — the output is
// a commission estimate (line 3714), not a capital figure.
test("REGRESSION: the estimate fallback multiplies by fee percent too", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { fundingEstimate: 50000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.potentialCommission, 5000);
  assert.notEqual(res.potentialCommission, 50000, "must not return raw capital as client value");
});

// REGRESSION: the written field is cf_potential_commission (doc 3706, 3710, 5046).
// `potential_value` was invented by the port and nothing reads it.
test("REGRESSION: writes potential_commission, not the invented potential_value", async () => {
  const db = pgFake({ clients: client() });
  await handle({ event: ev("round.approved", { approvedAmount: 10000, feePercent: 10 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(db.clients[0].custom_fields.potential_commission, 1000);
  assert.equal(db.clients[0].custom_fields.potential_value, undefined);
});

test("branch: a basis with no fee percent cannot produce a commission — no-op", async () => {
  const db = pgFake({ clients: client() });
  const res = await handle({ event: ev("round.approved", { fundingEstimate: 50000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_basis_for_estimate");
});

test("branch: no basis at all — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

// --- S-SYS1 smash: null event / missing client / duplicate / fetch trap / source grep ---

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("round.approved", { approvedAmount: 20000, feePercent: 10 }, { id: "evt-miss-sys01" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: client() });
    for (const bad of [null, undefined, "round.approved", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.clients[0].custom_fields.potential_commission, undefined);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate replay keeps one potential_commission, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: client() });
    const event = ev("round.approved", { approvedAmount: 20000, feePercent: 10 }, { id: "evt-dup-sys01", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.equal(first.potentialCommission, 2000);
    assert.equal(second.potentialCommission, 2000);
    assert.equal(db.clients[0].custom_fields.potential_commission, 2000);
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
