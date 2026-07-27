import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./f-11-bank-email-event-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withApprovalsStage = () => ({
  pipelineStages: [{ pipeline_key: "funding_card_stacking", stage_key: "approved", pipeline_id: "pl-1", stage_id: "st-approved" }]
});

test("happy path: APPROVED creates a task and moves the card to Approvals", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], ...withApprovalsStage() });
  const res = await handle({ event: ev("mail.response", { classification: "APPROVED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(res.card.moved, true);
  assert.equal(db.cards[0].stage_id, "st-approved");
});

test("branch: DENIED creates the routing task but does not move any card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("mail.response", { classification: "DENIED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.task.created, true);
  assert.equal(res.card, null);
});

test("branch: unclassified/NOISE events are ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("mail.response", { classification: "NOISE" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(db.tasks.length, 0);
});

test("duplicate delivery: replaying the same event does not double-create the task or re-move the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], ...withApprovalsStage() });
  const event = ev("mail.response", { classification: "COUNTEROFFER" }, { id: "evt-dup-f11", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.cards.length, 1);
});
