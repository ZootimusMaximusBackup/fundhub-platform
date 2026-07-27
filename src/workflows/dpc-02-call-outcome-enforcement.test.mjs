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

test("happy path: call happened before the check — moves to showed", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    events: [{ client_id: "cl-1", name: "call.completed" }],
    ...withStages()
  });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "showed");
  assert.equal(db.cards[0].stage_id, "st-showed");
});

test("branch: no call — no-show, tagged, moved to lost", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.outcome, "no_show");
  assert.deepEqual(db.clients[0].tags, ["call:no_show"]);
  assert.equal(db.cards[0].stage_id, "st-lost");
});

test("duplicate delivery: replaying does not double-move the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
  const event = ev("booking.created", {}, { id: "evt-dup-dpc02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.cards.length, 1);
});
