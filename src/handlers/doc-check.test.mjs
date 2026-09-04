import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_CODE,
  DOC_CHECK_TYPES,
  shouldRunDocCheck,
  onDocsReceivedDocCheck,
  parseAgentJson
} from "./doc-check.mjs";
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

test("DOC-CHECK types are the six client-document names from the spec", () => {
  assert.deepEqual([...DOC_CHECK_TYPES], [
    "id_document",
    "proof_of_address",
    "articles_of_organization",
    "ssn_card",
    "proof_of_income",
    "bank_statement"
  ]);
});

test("shouldRunDocCheck: client_upload subtype matches, inquiry_doc does not", () => {
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "id_document" }), true);
  assert.equal(shouldRunDocCheck({ kind: "id_document" }), true);
  assert.equal(shouldRunDocCheck({ kind: "inquiry_doc", subtype: "id_document" }), false);
  assert.equal(shouldRunDocCheck({ kind: "bureau_response", subtype: "bureau_letter" }), false);
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "other" }), true);
  assert.equal(shouldRunDocCheck({ kind: "client_upload", subtype: "articles_of_organization" }), true);
});

test("inquiry-docs handler and DOC-CHECK gate are different functions", () => {
  assert.notEqual(onDocsReceivedDocCheck, onDocsReceivedFlipInquiryGate);
  assert.equal(typeof onDocsReceivedFlipInquiryGate, "function");
});

test("onDocsReceivedDocCheck: inquiry_doc is skipped so the inquiry gate keeps that path", async () => {
  const res = await onDocsReceivedDocCheck(null, event({
    kind: "inquiry_doc", subtype: "id_document", document_id: "doc-1"
  }));
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_doc_check_kind");
});

test("onDocsReceivedDocCheck: retired DOC-CHECK does not queue SMS-DOC-02", async () => {
  const { SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "got your upload — one thing needs fixing", compliance_passed: true }
    ]
  });
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM agents/.test(sql)) {
      return { rows: [{
        code: AGENT_CODE,
        status: "retired",
        prompt: "You are the Document Check agent. Return JSON.",
        output_schema: { outcome: "accept, request_more, or hold" }
      }] };
    }
    return origQuery(sql, params);
  };
  let modelCalls = 0;
  const runs = [];
  const res = await onDocsReceivedDocCheck(db, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => {
      modelCalls += 1;
      return { mode: "live", text: JSON.stringify({ outcome: "request_more" }), error: null };
    },
    recordRunImpl: async (_db, row) => { runs.push(row); return row; }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "doc_check_retired");
  assert.equal(modelCalls, 0);
  assert.equal(db.messages.length, 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].agentCode, AGENT_CODE);
  assert.equal(runs[0].outcome, "doc_check_retired");
});

test("onDocsReceivedDocCheck: draft DOC-CHECK does not run", async () => {
  const res = await onDocsReceivedDocCheck({
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{
          code: AGENT_CODE,
          status: "draft",
          prompt: "You are the Document Check agent. Return JSON."
        }] };
      }
      return { rows: [] };
    }
  }, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async () => {
      throw new Error("draft must not call the model");
    }
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "doc_check_not_live");
});

test("onDocsReceivedDocCheck: runs DOC-CHECK and does not send", async () => {
  const runs = [];
  const prompts = [];
  const db = {
    async query(sql) {
      if (/FROM agents/.test(sql)) {
        return { rows: [{
          code: AGENT_CODE,
          prompt: "You are the Document Check agent. Return JSON.",
          output_schema: { outcome: "accept, request_more, or hold" }
        }] };
      }
      if (/FROM clients/.test(sql) && /first_name/.test(sql)) {
        return { rows: [{
          first_name: "Chris",
          last_name: "Stanbridge",
          custom_fields: {
            address_line1: "1005 W Hudson Way",
            address_city: "Gilbert",
            address_state: "AZ",
            address_zip: "85233"
          }
        }] };
      }
      return { rows: [] };
    }
  };
  const res = await onDocsReceivedDocCheck(db, event({
    kind: "client_upload",
    subtype: "id_document",
    document_id: "doc-1",
    original_filename: "id.png"
  }), {
    loadBytesImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/png" }),
    callModelImpl: async (args) => {
      prompts.push(args.user);
      return {
        mode: "shadow",
        text: JSON.stringify({ outcome: "accept", documents_reviewed: ["id"], issues: [] }),
        error: null
      };
    },
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
  assert.match(prompts[0], /1005 W Hudson Way/);
  assert.match(prompts[0], /Chris Stanbridge/);
  assert.match(prompts[0], /Today's date/);
});

test("clientContextLines: formats on-file address for the model", async () => {
  const { clientContextLines } = await import("./doc-check.mjs");
  const lines = clientContextLines({
    first_name: "Chris",
    last_name: "Stanbridge",
    custom_fields: {
      address_line1: "1005 W Hudson Way",
      address_city: "Gilbert",
      address_state: "AZ",
      address_zip: "85233"
    }
  });
  assert.ok(lines.some((l) => /Chris Stanbridge/.test(l)));
  assert.ok(lines.some((l) => /1005 W Hudson Way/.test(l)));
});

test("parseAgentJson reads fenced JSON", () => {
  const obj = parseAgentJson("```json\n{\"outcome\":\"request_more\"}\n```");
  assert.equal(obj.outcome, "request_more");
});

test("routeDocCheckOutcome: accept clears the document hold and sends DOC-03", async () => {
  const { routeDocCheckOutcome, EMAIL_DOC_03, SMS_DOC_03 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: EMAIL_DOC_03, channel: "email", body: "ok", compliance_passed: true },
      { org_id: ORG, template_key: SMS_DOC_03, channel: "sms", body: "ok sms", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-acc", json: { outcome: "accept" }
  });
  assert.equal(res.routed, true);
  assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Optimize Profile");
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(), [EMAIL_DOC_03, SMS_DOC_03].sort());
});

test("routeDocCheckOutcome: request_more keeps the gate and stores the agent note", async () => {
  const { routeDocCheckOutcome, SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const { FUNDING_DOC_HOLD } = await import("../inquiry-ops/doc-gate.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: { round_hold_reason: FUNDING_DOC_HOLD } }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "more", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
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

test("routeDocCheckOutcome: an accept that read nothing records no identity", async () => {
  const { routeDocCheckOutcome, EMAIL_DOC_03, SMS_DOC_03 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: EMAIL_DOC_03, channel: "email", body: "ok", compliance_passed: true },
      { org_id: ORG, template_key: SMS_DOC_03, channel: "sms", body: "ok sms", compliance_passed: true }
    ]
  });
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-acc-none",
    documentId: "doc-1", versionId: "ver-1",
    json: { outcome: "accept", documents_reviewed: ["bank statement"], issues: [] }
  });
  assert.equal(res.routed, true);
  assert.equal(res.identity.written, false);
  assert.equal(res.identity.reason, "nothing_verified");
});

test("routeDocCheckOutcome: request_more never records an identity, whatever the model read", async () => {
  const { routeDocCheckOutcome, SMS_DOC_02 } = await import("./doc-check.mjs");
  const { pgFake } = await import("../workflows/test-support.mjs");
  const db = pgFake({
    clients: [{ id: CLIENT, org_id: ORG, email: "a@b.com", custom_fields: {} }],
    templates: [
      { org_id: ORG, template_key: SMS_DOC_02, channel: "sms", body: "more", compliance_passed: true }
    ]
  });
  const seen = [];
  const orig = db.query.bind(db);
  db.query = async (sql, params) => { seen.push(sql); return orig(sql, params); };
  const res = await routeDocCheckOutcome(db, {
    orgId: ORG, clientId: CLIENT, eventId: "e-more-2",
    documentId: "doc-1", versionId: "ver-1",
    json: {
      outcome: "request_more",
      message_to_client: "retake it",
      verified_legal_name: "Christopher John Stanbridge",
      verified_address: { line1: "1005 W Hudson Way" },
      verified_date_of_birth: "1985-04-02"
    }
  });
  assert.equal(res.routed, true);
  assert.equal(res.identity, undefined);
  assert.equal(seen.some((s) => /pii_identity/.test(s)), false,
    "a document the agent refused proves nothing and must not reach pii_identity");
});
