import { test } from "node:test";
import assert from "node:assert";
import {
  handle, isHardDecline, HARD_DECLINE_SIGNALS_DEFERRED,
  DECLINE_EMAIL_TEMPLATE_KEY, DECLINE_SMS_TEMPLATE_KEY
} from "./c-06-crs-results-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding-path CRS results tag path:funding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
});

// Regression (Model drift audit): the production shape. The CRS adapter emits
// analysis.completed before decision.rendered writes clients.outcome_tier, so the
// column is null here — the tier has to come off the payload or this routes every
// real pull to "not_funding".
test("routes from the payload tier when clients.outcome_tier is not written yet", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: null }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "FULL_FUNDING", scores: { ex: 650 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
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
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }] });
  const res = await handle({
    event: ev("analysis.completed", { source: "crs", outcomeTier: "PREMIUM_STACK", scores: { ex: 780 } }, { clientId: "cl-1" }),
    db, step: fakeStep()
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
