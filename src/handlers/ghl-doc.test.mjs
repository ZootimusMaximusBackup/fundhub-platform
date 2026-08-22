import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CODE,
  GHL_DOC_TYPES,
  shouldRunGhlDoc,
  onDocsReceivedGhlDoc,
  parseAgentJson
} from "./ghl-doc.mjs";
import { onDocsReceivedFlipInquiryGate } from "./inquiry-docs.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function event(payload, extra = {}) {
  return {
    id: extra.id || "evt-doc-1",
    name: "docs.received",
    orgId: ORG,
    clientId: CLIENT,
    payload
  };
}

test("GHL-DOC types are the six client-document names from the spec", () => {
  assert.deepEqual([...GHL_DOC_TYPES], [
    "id_document",
    "proof_of_address",
    "articles_of_organization",
    "ssn_card",
    "proof_of_income",
    "bank_statement"
  ]);
});

test("shouldRunGhlDoc: client_upload subtype matches, inquiry_doc does not", () => {
  assert.equal(shouldRunGhlDoc({ kind: "client_upload", subtype: "id_document" }), true);
  assert.equal(shouldRunGhlDoc({ kind: "id_document" }), true);
  assert.equal(shouldRunGhlDoc({ kind: "inquiry_doc", subtype: "id_document" }), false);
  assert.equal(shouldRunGhlDoc({ kind: "bureau_response", subtype: "bureau_letter" }), false);
  assert.equal(shouldRunGhlDoc({ kind: "client_upload", subtype: "other" }), true);
  assert.equal(shouldRunGhlDoc({ kind: "client_upload", subtype: "articles_of_organization" }), true);
});

test("inquiry-docs handler and GHL-DOC gate are different functions", () => {
  assert.notEqual(onDocsReceivedGhlDoc, onDocsReceivedFlipInquiryGate);
  assert.equal(typeof onDocsReceivedFlipInquiryGate, "function");
});

test("onDocsReceivedGhlDoc: inquiry_doc is skipped so the inquiry gate keeps that path", async () => {
  const res = await onDocsReceivedGhlDoc(null, event({
    kind: "inquiry_doc", subtype: "id_document", document_id: "doc-1"
  }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_ghl_doc_kind");
});

test("onDocsReceivedGhlDoc: runs GHL-DOC and does not send", async () => {
  const runs = [];
  const db = {
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{
          code: AGENT_CODE,
          prompt: "You are the Document Check agent. Return JSON.",
          output_schema: { outcome: "accept, request_more, or hold" }
        }] };
      }
      return { rows: [] };
    }
  };
  const res = await onDocsReceivedGhlDoc(db, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1",
    original_filename: "id.png"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => ({
      mode: "shadow",
      text: JSON.stringify({ outcome: "accept", documents_reviewed: ["id"], issues: [] }),
      error: null
    }),
    recordRunImpl: async (_db, row) => { runs.push(row); return row; }
  });
  assert.equal(res.done, true);
  assert.equal(res.agent, AGENT_CODE);
  assert.equal(res.routed, true);
  assert.equal(res.json.outcome, "accept");
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agentCode, AGENT_CODE);
  assert.equal(runs[0].triggerEvent, "docs.received");
  assert.equal(runs[0].outcome, "accept");
});

test("parseAgentJson reads fenced JSON", () => {
  const obj = parseAgentJson("```json\n{\"outcome\":\"request_more\"}\n```");
  assert.equal(obj.outcome, "request_more");
});

test("routeGhlDocOutcome: accept clears the document hold and sends DOC-03", async () => {
  const { routeGhlDocOutcome, EMAIL_DOC_03, SMS_DOC_03 } = await import("./ghl-doc.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: EMAIL_DOC_03, channel: "email", body: "ok", compliance_passed: true },
      { org_id: ORG, template_key: SMS_DOC_03, channel: "sms", body: "ok sms", compliance_passed: true }
    ]
  });
  const res = await routeGhlDocOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-acc", json: { outcome: "accept" }
  });
  assert.equal(res.routed, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Optimize Profile");
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_DOC_03, SMS_DOC_03].sort());
});

test("routeGhlDocOutcome: request_more keeps the gate and stores the agent note", async () => {
  const { routeGhlDocOutcome, SMS_DOC_02 } = await import("./ghl-doc.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "more", compliance_passed: true }
    ]
  });
  const res = await routeGhlDocOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-more",
    json: { outcome: "request_more", message_to_client: "Need a clearer ID photo" }
  });
  assert.equal(res.routed, true);
  assert.equal(res.gate, "closed");
  assert.equal(db.clients[0].custom_fields.round_hold_reason, FUNDING_DOC_HOLD);
  assert.equal(db.clients[0].custom_fields.doc_agent_message, "Need a clearer ID photo");
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].template_key, SMS_DOC_02);
});
