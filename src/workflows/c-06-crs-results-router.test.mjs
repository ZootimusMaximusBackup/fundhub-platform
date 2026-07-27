import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-06-crs-results-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding-path CRS results tag path:funding", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_STACK_APPROVAL" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "funding");
  assert.deepEqual(db.clients[0].tags, ["path:funding"]);
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
