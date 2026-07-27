import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-00-crs-soft-pull-request.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: diagnostic.paid requests the CRS pull", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("diagnostic.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.crs_status, "Requested");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, "Awaiting CRS");
  assert.equal(res.scope, "consumer_only");
});

test("branch: business scope requested", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("diagnostic.paid", { businessScope: true }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.scope, "consumer_plus_ex_business");
});

test("branch: businessScope absent → defaults to consumer_only (payment events carry no scope)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("diagnostic.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.scope, "consumer_only");
  assert.equal(db.clients[0].custom_fields.crs_pull_scope, "consumer_only");
});
