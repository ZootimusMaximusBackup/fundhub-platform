import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./f-05-inquiry-cleanup-gate.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: open inquiries flip to Pending Removal", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    inquiryLog: [
      { client_id: "cl-1", status: "Active" },
      { client_id: "cl-1", status: "Active" }
    ]
  });
  const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.updated, 2);
  assert.ok(db.inquiryLog.every((r) => r.status === "Pending Removal"));
});

test("branch: already-Removed inquiries are left alone", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    inquiryLog: [{ client_id: "cl-1", status: "Removed" }]
  });
  const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.updated, 0);
  assert.equal(db.inquiryLog[0].status, "Removed");
});

test("duplicate delivery: replaying is a no-op the second time (already Pending Removal)", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    inquiryLog: [{ client_id: "cl-1", status: "Active" }]
  });
  const event = ev("round.approved", {}, { id: "evt-dup-f05", clientId: "cl-1" });
  const first = await handle({ event, db, step: fakeStep() });
  const second = await handle({ event, db, step: fakeStep() });
  assert.equal(first.updated, 1);
  assert.equal(second.updated, 0);
});
