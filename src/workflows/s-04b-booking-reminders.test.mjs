import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H } from "./s-04b-booking-reminders.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const sms = () => [
  { org_id: "org-1", template_key: SMS_CONFIRM, channel: "sms", body: "confirm {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_24H, channel: "sms", body: "24h {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_2H, channel: "sms", body: "2h {{appointment.start_time}}", compliance_passed: true }
];

test("s-04b: confirm + both reminders when startTime present", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(db.messages.length, 3);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H]);
  assert.equal(res.stoppedBecause, undefined);
});

test("s-04b: only confirm when no startTime", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(db.messages.length, 1);
  assert.equal(res.skippedReminders, "no_start_time");
});

test("s-04b: confirm SMS prints a human time, not raw ISO-Z", async () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: iso }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const confirm = db.messages.find((m) => m.template_key === SMS_CONFIRM);
  assert.ok(confirm);
  assert.doesNotMatch(confirm.rendered_body, /2026-08-23T02:49:58/);
  assert.match(confirm.rendered_body, /Aug/);
});

test("s-04b: stops before 24h reminder if call already held", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms(),
    events: [{ client_id: "cl-1", name: "call.completed" }]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.stoppedBecause, "call_held");
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].template_key, SMS_CONFIRM);
});
