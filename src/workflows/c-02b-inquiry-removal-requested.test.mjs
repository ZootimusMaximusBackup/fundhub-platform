import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./c-02b-inquiry-removal-requested.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: deposit.paid queues inquiry removal", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const res = await handle({ event: ev("deposit.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.run_inquiry_removal, true);
  assert.deepEqual(db.clients[0].tags, ["inquiry-removal-queued"]);
});

test("duplicate delivery: replaying does not duplicate the tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
  const event = ev("deposit.paid", {}, { id: "evt-dup-c02b", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.deepEqual(db.clients[0].tags, ["inquiry-removal-queued"]);
});
