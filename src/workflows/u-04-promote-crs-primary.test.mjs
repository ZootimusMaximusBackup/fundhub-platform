import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./u-04-promote-crs-primary.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: CRS result promotes to primary, removes the analyzer-primary tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["primary:analyzer"], custom_fields: {} }] });
  const res = await handle({ event: ev("analysis.completed", { source: "crs", scores: { ex: 700 } }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "CRS");
  assert.equal(db.clients[0].tags.includes("primary:analyzer"), false);
});

test("branch: analyzer-only source does not promote", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});
