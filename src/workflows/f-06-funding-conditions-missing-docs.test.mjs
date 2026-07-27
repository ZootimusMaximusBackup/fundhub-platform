import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-06-funding-conditions-missing-docs.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "missing docs email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "missing docs sms", compliance_passed: true }
];

test("happy path: MISSING_DOCS classification tags + holds the round + sends", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("mail.response", { classification: "MISSING_DOCS", conditionDescription: "Need bank statements" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "missing_docs");
  assert.deepEqual(db.clients[0].tags, ["docs:missing"]);
  assert.equal(db.fundingRounds[0].hold_reason, "Missing Documents");
  assert.equal(db.messages.length, 2);
});

test("branch: docs.received clears the tag and hold reason", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["docs:missing"] }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: "Missing Documents" }]
  });
  const res = await handle({ event: ev("docs.received", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.branch, "docs_received");
  assert.equal(db.clients[0].tags.includes("docs:missing"), false);
  assert.equal(db.fundingRounds[0].hold_reason, null);
});

test("branch: other classifications on mail.response are ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("mail.response", { classification: "APPROVED" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_missing_docs");
});

test("duplicate delivery: replaying MISSING_DOCS does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }],
    templates: withTemplates()
  });
  const event = ev("mail.response", { classification: "MISSING_DOCS", conditionDescription: "x" }, { id: "evt-dup-f06", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});
