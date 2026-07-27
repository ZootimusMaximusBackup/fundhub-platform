import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./at-01-first-touch-capture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: sets first touch date + lead magnet type", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.first_touch_date, "now");
  assert.equal(db.clients[0].custom_fields.lead_magnet_type, "Survey");
});

test("branch: already locked — never overwritten", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { first_touch_date: "2026-01-01" } }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "already_locked");
  assert.equal(db.clients[0].custom_fields.first_touch_date, "2026-01-01");
});

test("duplicate delivery: replaying does not change the locked value", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("entry.captured", {}, { id: "evt-dup-at01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.clients[0].custom_fields.first_touch_date, "now");
});
