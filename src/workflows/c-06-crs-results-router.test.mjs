import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-06-crs-results-router.mjs";
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
