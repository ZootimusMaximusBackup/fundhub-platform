import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-01-new-lead-intake.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: entry.captured sets lifecycle status + lead:new tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "New Lead");
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
});

test("duplicate delivery: replaying does not duplicate the tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("entry.captured", {}, { id: "evt-dup-s01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
});
