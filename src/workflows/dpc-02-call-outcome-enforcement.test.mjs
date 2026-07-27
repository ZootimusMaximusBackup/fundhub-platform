import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./dpc-02-call-outcome-enforcement.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "showed", pipeline_id: "pl-sales", stage_id: "st-showed" },
    { pipeline_key: "sales", stage_key: "lost", pipeline_id: "pl-sales", stage_id: "st-lost" }
  ]
});

// A booking ending 1 hour from now.
const futureEnd = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

test("sleepUntil is set to appointment end + 5 minutes, not a flat duration", async () => {
  const endTime = futureEnd();
  const expectedWake = new Date(new Date(endTime).getTime() + 5 * 60 * 1000);
  const sleepUntilCalls = [];
  const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  await handle({ event: ev("booking.created", { endTime }, { clientId: "cl-1" }), db, step });
  assert.equal(sleepUntilCalls.length, 1);
  assert.equal(sleepUntilCalls[0].id, "wait-until-5-min-after-end");
  // Target must be at least endTime + 5m (within 1 second tolerance for test runtime).
  assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expectedWake.getTime()) < 1000,
    `sleepUntil target should be ~endTime+5m, got ${sleepUntilCalls[0].target.toISOString()}`);
});

test("falls back to startTime when endTime absent", async () => {
  const startTime = futureEnd();
  const sleepUntilCalls = [];
  const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  await handle({ event: ev("booking.created", { startTime }, { clientId: "cl-1" }), db, step });
  assert.equal(sleepUntilCalls.length, 1);
  const expected = new Date(new Date(startTime).getTime() + 5 * 60 * 1000);
  assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expected.getTime()) < 1000);
});

test("no appointment time → early exit, no sleep", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_appointment_time");
});

test("happy path: call happened before the check — moves to showed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [{ client_id: "cl-1", name: "call.completed" }],
    ...withStages()
  });
  const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "showed");
  assert.equal(db.cards[0].stage_id, "st-showed");
});

test("branch: no call — no-show, tagged, moved to lost", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "no_show");
  assert.deepEqual(db.clients[0].tags, ["call:no_show"]);
  assert.equal(db.cards[0].stage_id, "st-lost");
});

test("duplicate delivery: replaying does not double-move the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const event = ev("booking.created", { endTime: futureEnd() }, { id: "evt-dup-dpc02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.cards.length, 1);
});
