import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./u-03-crs-snapshot-sync.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: CRS-sourced analysis.completed syncs the snapshot fields", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 640 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
  assert.equal(db.clients[0].custom_fields.crs_fico_score, 640);
  assert.deepEqual(db.clients[0].tags, ["crs:snapshot"]);
  assert.equal(res.ax07.fired, false);
});

test("branch: non-CRS source (e.g. analyzer estimate) is ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_crs_source");
});
