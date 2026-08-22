import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, n01ColdNurture } from "./n-01-cold-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Cold nurture email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Cold nurture sms body", compliance_passed: true }
];

test("RETIRED 2026-08-22: entry.captured trigger is not registered", () => {
  assert.deepEqual(n01ColdNurture.opts.triggers, []);
});

test("happy path: cold lead (entry.captured only) gets email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", { clientId: "cl-1" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.email.sent, true);
  assert.equal(res.sms.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: lead who already submitted the survey is warm, not cold — no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "entry.captured" },
      { client_id: "cl-1", name: "survey.submitted" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_cold:warm");
  assert.equal(db.messages.length, 0);
});

test("branch: no client resolvable — no send, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("entry.captured", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_client");
});

test("branch: template not yet seeded — send is a safe no-op, never invents copy", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: []
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true, "still a 'sent' attempt at the workflow level");
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

// End-to-end merge-tag proof through a real workflow. The unit-level coverage lives in
// messaging.test.mjs and render-template.test.mjs; this asserts the whole path a live
// send actually takes — workflow → sendTemplated → client record → renderTemplate →
// messages.rendered_body — because that is where the bug was visible: real GHL copy is
// written in `{{contact.*}}` tags and every outbound body carried them literally.
//
// The shared pgFake has no branch for sendTemplated's client-context query, so it's
// decorated locally rather than edited in test-support.mjs (other sessions are in there).
const withClientContext = (db, row) => ({
  ...db,
  async query(sql, params = []) {
    if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients/.test(sql)) {
      return { rows: params[0] === row.id ? [row] : [] };
    }
    return db.query(sql, params);
  }
});

test("REGRESSION: a real workflow send renders {{contact.*}} — no literal braces reach the message row", async () => {
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Hi {{contact.first_name}}, your {{contact.analyzer_prequal_amount}} pre-approval is ready.", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Hey {{contact.first_name}} — {{contact.business_name}}?", compliance_passed: true }
    ]
  });
  const db = withClientContext(base, {
    id: "cl-1", first_name: "Dana", last_name: "Reyes", email: "a@b.com", phone: "+15550000",
    custom_fields: { analyzer_prequal_amount: 50000, business_name: "Reyes Haulage" }
  });

  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  const bodies = base.messages.map((m) => m.rendered_body);
  assert.deepEqual(bodies, [
    "Hi Dana, your 50000 pre-approval is ready.",
    "Hey Dana — Reyes Haulage?"
  ]);
  for (const b of bodies) assert.ok(!b.includes("{{"), `unrendered merge tag reached an outbound body: ${b}`);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-1", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() }); // replay
  assert.equal(db.messages.length, 2, "one email + one sms, not four");
});
