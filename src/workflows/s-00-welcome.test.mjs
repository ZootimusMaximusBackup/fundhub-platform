import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./s-00-welcome.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const templates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "welcome", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "welcome sms", compliance_passed: true }
];

test("s-00: entry.captured sends welcome email and sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const res = await handle({
    event: ev("entry.captured", {}, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.deepEqual(db.messages.map((m) => m.template_key), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY]);
});

test("s-00: no client — no send", async () => {
  const db = pgFake({ templates: templates() });
  const res = await handle({ event: ev("entry.captured", {}), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(db.messages.length, 0);
});

test("s-00: second entry.captured does not send again", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const first = await handle({
    event: ev("entry.captured", {}, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const second = await handle({
    event: ev("entry.captured", {}, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(first.done, true);
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_locked");
  assert.equal(db.messages.length, 2);
});

test("s-00: two pings at once still send welcome only once", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: templates()
  });
  const [a, b] = await Promise.all([
    handle({ event: ev("entry.captured", {}, { id: "evt-a", clientId: "cl-1" }), db, step: fakeStep() }),
    handle({ event: ev("entry.captured", {}, { id: "evt-b", clientId: "cl-1" }), db, step: fakeStep() })
  ]);
  const wins = [a, b].filter((r) => r.done).length;
  const skips = [a, b].filter((r) => r.reason === "already_locked").length;
  assert.equal(wins, 1);
  assert.equal(skips, 1);
  assert.equal(db.messages.length, 2);
});
