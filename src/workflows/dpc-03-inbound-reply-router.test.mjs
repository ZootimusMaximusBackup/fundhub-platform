import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./dpc-03-inbound-reply-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "closed_won", pipeline_id: "pl-sales", stage_id: "st-closed" },
    { pipeline_key: "sales", stage_key: "downsell", pipeline_id: "pl-sales", stage_id: "st-downsell" }
  ]
});

test("happy path: YES reply creates the contract task and moves to closed", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "YES let's do it" }), db, step: fakeStep() });
  assert.equal(res.decision, "yes");
  assert.equal(res.task.created, true);
  assert.equal(db.cards[0].stage_id, "st-closed");
});

test("branch: RESCHEDULE reply creates the booking-link task + sends the reschedule SMS, no card move", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: "SMS-DPC04-RESCHEDULE-REBOOKING", channel: "sms", body: "reschedule", compliance_passed: true }],
    ...withStages()
  });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "can we reschedule" }), db, step: fakeStep() });
  assert.equal(res.decision, "reschedule");
  assert.equal(res.sms.sent, true);
  assert.deepEqual(db.clients[0].tags, ["setter:reschedule"]);
  assert.equal(db.cards.length, 0);
});

test("branch: CLOSE reply moves to downsell + clears nurture tags", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", tags: ["nurture:warm"], custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "please close my file" }), db, step: fakeStep() });
  assert.equal(res.decision, "close_file");
  assert.equal(db.clients[0].tags.includes("nurture:warm"), false);
  assert.equal(db.cards[0].stage_id, "st-downsell");
});

test("branch: no decision keyword — ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567" }] });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "what time is my call" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("branch: unknown phone number does not mint a client", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("message.inbound", { from: "+19998887777", body: "YES" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.clients.length, 0);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const event = ev("message.inbound", { from: "+15551234567", body: "YES" }, { id: "evt-dup-dpc03" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
