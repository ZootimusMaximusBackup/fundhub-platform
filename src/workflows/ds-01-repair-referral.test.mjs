import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handle, isRepairReferral, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./ds-01-repair-referral.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = fileURLToPath(new URL("./ds-01-repair-referral.mjs", import.meta.url));

async function withFetchTrap(fn) {
  const calls = [];
  const prior = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    throw new Error(`DS-01 must not POST via fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prior;
  }
}

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "repair referral email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "repair referral sms", compliance_passed: true }
];

const client = (over = {}) => [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15550000",
  outcome_tier: "REPAIR_ONLY", custom_fields: {}, ...over }];

const referral = (extra = {}) => ({ outcome: "declined", repairReferral: true, ...extra });

// --- trigger discrimination (05/30 doc 74-78, 84-86, 157) -------------------

test("isRepairReferral: the explicit Stage 5 Sales Outcome wins when present", () => {
  assert.equal(isRepairReferral({ salesOutcome: "Repair Referral Sent" }), true);
  assert.equal(isRepairReferral({ salesOutcome: "Funding Didn't Buy" }), false);
  assert.equal(isRepairReferral({ salesOutcome: "DIY Letters Purchased" }), false);
});

// THE REGRESSION: this used to fire on ANY declined disposition.
test("REGRESSION: a plain declined call is no longer a repair referral", () => {
  assert.equal(isRepairReferral({ outcome: "declined" }), false);
});

test("REGRESSION: hard declines (OFAC / fraud / severe record) never get a partner referral", () => {
  for (const reason of ["OFAC", "fraud_flag", "hard_decline", "disqualified"]) {
    assert.equal(isRepairReferral(referral({ declineReason: reason })), false, `reason ${reason}`);
  }
});

test("isRepairReferral: a genuine repair referral passes", () => {
  assert.equal(isRepairReferral(referral()), true);
});

// --- the workflow -----------------------------------------------------------

test("happy path: repair referral on a non-funding path sends and routes to Referred", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.product_path, "Referred");
  assert.ok(db.clients[0].tags.includes("client:repair-referral"));
});

test("REGRESSION: a hard decline reaches the workflow and sends nothing", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral({ declineReason: "fraud" }), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_repair_referral");
  assert.equal(db.messages.length, 0, "a fraud decline must never receive a repair partner referral");
});

test("branch: never fires on the funding route", async () => {
  const db = pgFake({ clients: client({ outcome_tier: "FULL_FUNDING" }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "blocked_funding_route:FULL_FUNDING");
  assert.equal(db.messages.length, 0);
});

// Doc 1284-1285 / Part B 140-141 — this workflow sends an SMS, so both must be present.
test("branch: missing phone fails the identity gate before anything is written", async () => {
  const db = pgFake({ clients: client({ phone: null }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.reason, "missing_identity");
  assert.equal(db.messages.length, 0);
  assert.equal(db.clients[0].custom_fields.product_path, undefined);
});

test("branch: pending copy — template not seeded yet, safe no-op", async () => {
  const db = pgFake({ clients: client(), templates: [] });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sms.reason, "template_pending");
});

// workflow-migration-table.md row 25: the "never fires on the funding route" guard reads
// clients.outcome_tier, which is unwritten at call.completed (decision.rendered — the
// only handler that writes it — hasn't fired yet at that point in the real event order).
// NOT fixed here — that's the open Stage-5 Sales Outcome signal question, and the trigger
// stays as-is per instruction. Every other test in this file pre-seeds a non-null tier,
// which masks this: this locks in what handle() actually does today on the real,
// genuinely-null-at-call-time shape, so the gap stays visible instead of hidden by fixture.
test("DS-01 — outcome_tier is genuinely null at call.completed: locks in current (unfixed) behavior", async () => {
  const db = pgFake({ clients: client({ outcome_tier: null }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  // isFundingPath(null) is false, so the guard does not block — DS-01 proceeds and sends
  // the repair referral even though the real tier is still unknown at this point.
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.product_path, "Referred");
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const event = ev("call.completed", referral(), { id: "evt-dup-ds01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});

// --- B29 smash: missing client / funding lane / null event / no Vercel / no drain ---

test("smash: Funding Didn't Buy declineReason is never a repair referral", () => {
  assert.equal(
    isRepairReferral(referral({ declineReason: "Funding Didn't Buy" })),
    false,
    "funding-lane decline must not become a partner referral"
  );
  assert.equal(isRepairReferral(referral({ reason: "funding_didnt_buy" })), false);
});

test("smash: missing client does not throw, does not send, does not fetch", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    const res = await handle({
      event: ev("call.completed", referral(), { clientId: null }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: client(), templates: withTemplates() });
    const res = await handle({ event: null, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: funding-path client (all funding tiers) never sends or tags as repair referral", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const tier of ["FULL_FUNDING", "FUNDING_PLUS_REPAIR", "PREMIUM_STACK"]) {
      const db = pgFake({ clients: client({ outcome_tier: tier }), templates: withTemplates() });
      const res = await handle({
        event: ev("call.completed", referral(), { clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, false, tier);
      assert.equal(res.reason, `blocked_funding_route:${tier}`, tier);
      assert.equal(db.messages.length, 0, tier);
      assert.ok(!(db.clients[0].tags || []).includes("client:repair-referral"), tier);
      assert.equal(db.clients[0].custom_fields.product_path, undefined, tier);
    }
    assert.equal(calls.length, 0);
  });
});

test("smash: Funding Didn't Buy payload reaches handle and sends nothing", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: client(), templates: withTemplates() });
    const res = await handle({
      event: ev("call.completed", referral({ declineReason: "Funding Didn't Buy" }), { clientId: "cl-1" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "not_repair_referral");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate replay does not double-send, fetch, or drain outbox", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: client(), templates: withTemplates() });
    const event = ev("call.completed", referral(), { id: "evt-dup-ds01-smash", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.equal(db.messages.length, 2, "queued once per channel; replay must not double");
    // sendTemplated only inserts rows — DS-01 never dispatches / drains (source + fetch fence).
    assert.equal(calls.length, 0);
  });
});

test("smash: source must not POST Vercel or drain the outbox", () => {
  const code = readFileSync(SRC, "utf8");
  assert.ok(code.includes("isRepairReferral"), "canary: DS-01 source was actually read");
  assert.doesNotMatch(code, /vercel\.app/i);
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bdispatch\b/);
  assert.doesNotMatch(code, /\bdrainOutbox\b/);
  assert.doesNotMatch(code, /\bmessage-dispatch/);
});
