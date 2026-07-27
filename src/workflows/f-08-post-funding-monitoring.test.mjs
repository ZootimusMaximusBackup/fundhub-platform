import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./f-08-post-funding-monitoring.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: round.funded creates the 30-day check-in task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks.length, 1);
});

test("branch: no resolvable client — no task, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("round.funded", {}), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying the same event does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const event = ev("round.funded", {}, { id: "evt-dup-f08", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
