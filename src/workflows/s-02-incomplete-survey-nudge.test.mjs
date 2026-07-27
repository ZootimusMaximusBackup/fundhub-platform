import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY } from "./s-02-incomplete-survey-nudge.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: survey still incomplete after the wait sends the nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, true);
  assert.equal(db.messages.length, 1);
});

test("branch: survey completed during the wait — tag instead of nudge", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "survey.submitted" }]
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.nudged, false);
  assert.deepEqual(db.clients[0].tags, ["survey:complete"]);
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "finish it", compliance_passed: true }]
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-s02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});
