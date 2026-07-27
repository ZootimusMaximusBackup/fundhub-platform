import { test } from "node:test";
import assert from "node:assert";
import { handle, FRICTION } from "./bc-02-customer-friction.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: ar:collections tag scores High", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["ar:collections"] }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.friction, "high");
  assert.equal(db.behaviorScores[0].friction, FRICTION.high);
});

test("branch: docs:missing scores Medium", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["docs:missing"] }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.friction, "medium");
});

test("branch: no escalation tags scores Low", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [] }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.friction, "low");
});
