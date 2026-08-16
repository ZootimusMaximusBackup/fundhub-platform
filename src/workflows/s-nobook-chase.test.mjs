import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03 } from "./s-nobook-chase.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templates = () => [
  { org_id: "org-1", template_key: SMS_NOBOOK_01, channel: "sms", body: "n1", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_02, channel: "sms", body: "n2", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_NOBOOK_03, channel: "sms", body: "n3", compliance_passed: true }
];

test("nobook: full cadence when never booked", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_NOBOOK_01, SMS_NOBOOK_02, SMS_NOBOOK_03]);
});

test("nobook: exits immediately if already booked", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates(),
    events: [{ client_id: "cl-1", name: "booking.created" }]
  });
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.exitedAt, "already_booked");
  assert.equal(db.messages.length, 0);
});

test("nobook: stops mid-cadence when they book after msg1", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  let sends = 0;
  const step = {
    run: async (id, fn) => {
      if (id.startsWith("send-")) sends += 1;
      if (sends === 1 && !db.events.some((e) => e.name === "booking.created")) {
        db.events.push({ client_id: "cl-1", name: "booking.created" });
      }
      return fn();
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };
  const res = await handle({
    event: ev("survey.submitted", {}, { clientId: "cl-1" }),
    db, step
  });
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 1);
});
