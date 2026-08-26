import { test } from "node:test";
import assert from "node:assert/strict";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { pgFake } from "../workflows/test-support.mjs";
import {
  register,
  onInquiryDocsNeeded,
  onDocsReceivedFlipInquiryGate,
  EMAIL_TEMPLATE_KEY,
  SMS_TEMPLATE_KEY
} from "./inquiry-docs.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function withDocChase(seed = {}) {
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", phone: "+16616054248", custom_fields: {}, tags: [] }],
    templates: [
      { org_id: ORG, template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "docs", compliance_passed: true },
      { org_id: ORG, template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "docs sms", compliance_passed: true }
    ],
    ...seed
  });
  const cases = seed.cases || [];
  const documents = seed.documents || [];
  const orig = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/FROM inquiry_removal_cases/.test(sql)) {
      if (/Blocked/.test(sql)) {
        return { rows: cases.filter((c) => c.client_id === params[1] && c.case_status === "Blocked") };
      }
      const statuses = Array.isArray(params[2]) ? params[2] : null;
      return {
        rows: cases.filter((c) => c.client_id === params[1] && (!statuses || statuses.includes(c.case_status)))
      };
    }
    if (/FROM documents/.test(sql)) {
      return { rows: documents.filter((d) => d.client_id === params[1]) };
    }
    if (/FROM messages/.test(sql) && /template_key IN/.test(sql)) {
      const hit = db.messages.find((m) => m.template_key === EMAIL_TEMPLATE_KEY || m.template_key === SMS_TEMPLATE_KEY);
      return { rows: hit ? [{}] : [] };
    }
    return orig(sql, params);
  };
  return db;
}

test("register wires inquiry.docs.needed and docs.received", () => {
  clearHandlers();
  register();
  assert.ok(getHandlers("inquiry.docs.needed").includes(onInquiryDocsNeeded));
  assert.ok(getHandlers("docs.received").includes(onDocsReceivedFlipInquiryGate));
});

test("inquiry.docs.needed sends DOC-01 once", async () => {
  const db = withDocChase();
  const res = await onInquiryDocsNeeded({
    id: "evt-need",
    orgId: ORG,
    clientId: CLIENT,
    payload: { missing: ["id_document"] }
  }, db);
  assert.equal(res.done, true);
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY].sort());
  const again = await onInquiryDocsNeeded({
    id: "evt-need-2",
    orgId: ORG,
    clientId: CLIENT,
    payload: { missing: ["id_document"] }
  }, db);
  assert.equal(again.sent, false);
  assert.equal(again.reason, "already_sent");
  assert.equal(db.messages.length, 2);
});

test("docs.received with an active case and missing packet sends DOC-01", async () => {
  const db = withDocChase({
    cases: [{ id: "case-1", org_id: ORG, client_id: CLIENT, case_status: "Queued" }]
  });
  const res = await onDocsReceivedFlipInquiryGate({
    id: "evt-up",
    orgId: ORG,
    clientId: CLIENT,
    payload: { kind: "inquiry_doc" }
  }, db);
  assert.equal(res.done, true);
  assert.equal(res.chase.sent, true);
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY].sort());
});

test("docs.received with no inquiry case does not send DOC-01", async () => {
  const db = withDocChase();
  const res = await onDocsReceivedFlipInquiryGate({
    id: "evt-course",
    orgId: ORG,
    clientId: CLIENT,
    payload: { kind: "client_upload" }
  }, db);
  assert.equal(res.done, true);
  assert.equal(res.chase, null);
  assert.equal(db.messages.length, 0);
});
