import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, EMAIL_FOLLOWUP_TEMPLATE_KEY } from "./f-02-portal-id-missing.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "id needed", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "id needed sms", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_FOLLOWUP_TEMPLATE_KEY, channel: "email", body: "still missing", compliance_passed: true }
];

test("happy path: still missing at both checks — nudge + follow-up sent, tagged", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { id_uploaded: false } }], templates: withTemplates() });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.resolved, false);
  assert.equal(res.email1.sent, true);
  assert.equal(res.sms1.sent, true);
  assert.equal(res.email2.sent, true);
  assert.deepEqual(db.clients[0].tags, ["docs:missing"]);
  assert.equal(db.messages.length, 3);
});

test("branch: already complete at the first check — no send, no tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { id_uploaded: true, portal_onboarding_status: "Complete" } }], templates: withTemplates() });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.resolved, true);
  assert.equal(res.atCheck, 1);
  assert.equal(db.messages.length, 0);
});

test("branch: uploaded between the first nudge and the follow-up — tag cleared, no follow-up sent", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { id_uploaded: false } }];
  const db = pgFake({ clients, templates: withTemplates() });
  // fakeStep's sleep is a no-op, so simulate "docs arrived mid-wait" by flipping the
  // fake's own state right before the handler's post-first-wait steps run — a custom
  // step fake that mutates state exactly once, between the two sleeps.
  let flips = 0;
  const step = {
    run: (_id, fn) => fn(),
    sleep: async () => { flips += 1; if (flips === 2) { clients[0].custom_fields.id_uploaded = true; clients[0].custom_fields.portal_onboarding_status = "Complete"; } }
  };
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step });
  assert.equal(res.resolved, true);
  assert.equal(res.atCheck, 2);
  assert.equal(db.clients[0].custom_fields.last_progress_action, "docs_uploaded");
  assert.equal(db.clients[0].tags.includes("docs:missing"), false);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { id_uploaded: false } }], templates: withTemplates() });
  const event = ev("round.started", {}, { id: "evt-dup-f02", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 3);
});
