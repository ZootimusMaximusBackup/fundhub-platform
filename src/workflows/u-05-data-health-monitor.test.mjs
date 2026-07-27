import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./u-05-data-health-monitor.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: complete fields clear any incomplete tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["analyzer:data-incomplete"] }] });
  const res = await handle({ event: ev("analysis.completed", { scores: { ex: 640 }, utilization: 0.3 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.healthy, true);
  assert.equal(db.clients[0].tags.includes("analyzer:data-incomplete"), false);
});

test("branch: missing critical fields tags incomplete + creates a task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("analysis.completed", { scores: {} }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.healthy, false);
  assert.equal(res.task.created, true);
  assert.deepEqual(db.clients[0].tags, ["analyzer:data-incomplete"]);
});

test("duplicate delivery: replaying does not double-create the mapping task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const event = ev("analysis.completed", { scores: {} }, { id: "evt-dup-u05", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
