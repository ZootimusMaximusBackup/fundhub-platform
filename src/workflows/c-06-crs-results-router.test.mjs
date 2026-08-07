import { test } from "node:test";
import assert from "node:assert";
import {
  handle, isHardDecline, HARD_DECLINE_SIGNALS_DEFERRED,
  DECLINE_EMAIL_TEMPLATE_KEY, DECLINE_SMS_TEMPLATE_KEY
} from "./c-06-crs-results-router.mjs";
import { DELIVER_LETTERS_URL } from "./ds-02-diy-letters.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

// Every funding-branch test now also fires the deliver-letters webhook (row 20), so a
// fake fetch is required — the default `fetchImpl` is global fetch, and a real network
// call has no place in a unit test (mirrors ds-02's own fakeFetch pattern).
/* Same as ds-02: these assert delivery happens, so the adapters fence must be
   declared down. It defaults to blocked and handle() takes no env. */
process.env.ADAPTERS_DRY_RUN = "0";

// text() is required: outbound calls now read the body once as text.
const fakeFetch = (ok = true) => async () => ({ ok, status: ok ? 200 : 500, text: async () => "{}" });

test("happy path: funding-path CRS results tag path:funding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { clientId: "cl-1" }), db, step: fakeStep(), fetchImpl: fakeFetch(true) });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
});

// Regression (Model drift audit): the production shape. The CRS adapter emits
// analysis.completed before decision.rendered writes clients.outcome_tier, so the
// column is null here — the tier has to come off the payload or this routes every
// real pull to "not_funding".
test("routes from the payload tier when clients.outcome_tier is not written yet", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "FULL_FUNDING", scores: { ex: 650 } }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
});

test("routes repair from the payload tier with the column still null", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "REPAIR_ONLY", scores: { ex: 600 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.branch, "repair");
  assert.deepEqual(db.clients[0].tags, ["path:repair"]);
});

test("a re-pull's payload tier wins over the stale column", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "PREMIUM_STACK", scores: { ex: 780 } }, { clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl: fakeFetch(true)
  });
  assert.equal(res.branch, "funding");
});

test("branch: missing results holds instead of routing", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: {} }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "missing_results");
  assert.deepEqual(db.clients[0].tags, ["hold:snapshot_missing"]);
});

test("branch: non-CRS source is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

// --- DECLINE branch (05/30 Stage 5, doc 84-86 / 4204-4222) -------------------
// The branch is wired end to end but GATE C-06C is DEFERRED (doc 4204: "exact field/tag
// names until CRS onboarding finalizes"). These tests lock in that it NO-OPS rather than
// guessing — the day the signal map lands, flip HARD_DECLINE_SIGNALS_DEFERRED and the
// third test below is what proves the wiring was already correct.

test("DEFERRED: hard-decline detection no-ops — no decline messaging fires on a guess", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }] });
  const res = await handle({
    // every shape that might read as a decline to a guessing implementation
    event: ev("analysis.completed", {
      source: "crs", scores: { ex: 480 }, ofac: true, fraudAlert: true,
      publicRecords: ["bankruptcy"], outcomeTier: "FRAUD_HOLD"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.notEqual(res.branch, "decline", "must not decline while the signal map is DEFERRED");
  assert.equal(db.messages.length, 0, "no decline email or SMS may send off an invented threshold");
  assert.ok(!(db.clients[0].tags || []).includes("hold:declined"));
});

test("isHardDecline is the single deferred detector, and it is currently a no-op", () => {
  assert.equal(HARD_DECLINE_SIGNALS_DEFERRED, true);
  assert.equal(isHardDecline({ ofac: true, fraudAlert: true }), false);
});

test("the DECLINE branch is fully wired — it fires the moment the detector returns true", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: DECLINE_EMAIL_TEMPLATE_KEY, channel: "email", body: "declined", compliance_passed: true },
      { org_id: "org-1", template_key: DECLINE_SMS_TEMPLATE_KEY, channel: "sms", body: "declined", compliance_passed: true }
    ]
  });
  // Exercise the branch directly, standing in for the future real detector.
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", scores: { ex: 480 } }, { clientId: "cl-1" }),
    db, step: fakeStep(), detectDecline: () => true
  });
  assert.equal(res.branch, "decline");
  assert.deepEqual(db.clients[0].tags, ["hold:declined"]);
  assert.equal(db.clients[0].custom_fields.hard_stop_reason, "disqualified");
  assert.equal(db.messages.length, 2, "decline email + SMS");
  assert.equal(db.tasks.length, 1);
});

// The test above exercises the wiring via a totally separate `detectDecline` override —
// it never actually calls isHardDecline, so it wouldn't catch a bug in the flag-gating
// itself. HARD_DECLINE_SIGNALS_DEFERRED is a `const`, so a test can't flip it directly;
// `deferred`/`signalMap` on isHardDecline are the seam that lets this go through the real
// function instead. This proves that the day the flag is off and a signal map exists,
// the branch is verified end to end rather than hoped.
test("flipping HARD_DECLINE_SIGNALS_DEFERRED off (via isHardDecline's own gate, not an unrelated override) reaches the decline branch end to end", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null, custom_fields: {} }],
    templates: [
      { org_id: "org-1", template_key: DECLINE_EMAIL_TEMPLATE_KEY, channel: "email", body: "declined", compliance_passed: true },
      { org_id: "org-1", template_key: DECLINE_SMS_TEMPLATE_KEY, channel: "sms", body: "declined", compliance_passed: true }
    ]
  });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", scores: { ex: 480 } }, { clientId: "cl-1" }),
    db, step: fakeStep(),
    // Stands in for "HARD_DECLINE_SIGNALS_DEFERRED flipped to false, signal map landed" —
    // still routes through the real isHardDecline, just with its gate/map overridden.
    detectDecline: (payload) => isHardDecline(payload, { deferred: false, signalMap: () => true })
  });
  assert.equal(res.branch, "decline");
  assert.deepEqual(db.clients[0].tags, ["hold:declined"]);
  assert.equal(db.clients[0].custom_fields.hard_stop_reason, "disqualified");
  assert.equal(db.messages.length, 2, "decline email + SMS");
  assert.equal(db.tasks.length, 1);
});

// --- FUNDING branch deliver-letters webhook (row 20) -------------------------
// C-06's FUNDING branch never fired the deliver-letters webhook with the funding letter
// set — reuses ds-02's DELIVER_LETTERS_URL, same webhook, `letterSet` picks the pack.

test("row 20: the FUNDING branch fires the deliver-letters webhook with the funding letter set", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  let calledUrl = null;
  let calledBody = null;
  const fetchImpl = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => "{}" };
  };
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { id: "evt-c06-funding", clientId: "cl-1" }),
    db, step: fakeStep(), fetchImpl
  });
  assert.equal(res.branch, "funding");
  assert.equal(res.delivery.delivered, true);
  assert.equal(calledUrl, DELIVER_LETTERS_URL, "must reuse ds-02's DELIVER_LETTERS_URL, not a new one");
  assert.equal(calledBody.letterSet, "funding");
  assert.equal(calledBody.clientId, "cl-1");
  assert.equal(db.clients[0].custom_fields.funding_letters_delivered_event_id, "evt-c06-funding");
});

test("row 20: replaying the same event does not double-POST the deliver-letters webhook", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  let fetchCallCount = 0;
  const countingFetch = async () => { fetchCallCount++; return { ok: true, status: 200, text: async () => "{}" }; };
  const event = ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { id: "evt-dup-c06-funding", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep(), fetchImpl: countingFetch });
  await handle({ event, db, step: fakeStep(), fetchImpl: countingFetch });
  assert.equal(fetchCallCount, 1, "webhook POST must not fire on replay");
});
