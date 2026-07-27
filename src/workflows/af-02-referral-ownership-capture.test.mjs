import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./af-02-referral-ownership-capture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

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
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("entry.captured", { a1: "aff-123" }, { id: "evt-dup-af02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.clients[0].custom_fields.affiliate_tier1_owner, "aff-123");
});
