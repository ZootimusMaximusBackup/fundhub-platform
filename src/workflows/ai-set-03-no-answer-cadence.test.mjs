import { test } from "node:test";
import assert from "node:assert";
import { handle, MSG1_KEY, MSG2_KEY, MSG3_KEY } from "./ai-set-03-no-answer-cadence.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [MSG1_KEY, MSG2_KEY, MSG3_KEY].map((k) => ({ org_id: "org-1", template_key: k, channel: "sms", body: k, compliance_passed: true }));

test("happy path: full cadence sends all 3 messages when never rebooked", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", { disposition: "no_answer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
});

test("branch: rebooking after msg1 stops the cadence early", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }];
  const events = [];
  const db = pgFake({ clients, events, templates: withTemplates() });
  let sleeps = 0;
  const step = { run: (_id, fn) => fn(), sleep: async () => { sleeps += 1; if (sleeps === 1) events.push({ client_id: "cl-1", name: "booking.created" }); } };
  const res = await handle({ event: ev("call.completed", { disposition: "no_answer" }, { clientId: "cl-1" }), db, step });
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 1);
});

test("branch: answered calls are ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { disposition: "transferred" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("call.completed", { disposition: "no_answer" }, { id: "evt-dup-aiset03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 3);
});
