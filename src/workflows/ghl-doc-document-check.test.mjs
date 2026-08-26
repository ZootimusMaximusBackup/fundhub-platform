import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./ghl-doc-document-check.mjs";
import { ev, pgFake } from "./test-support.mjs";

test("docs.received does not queue SMS-DOC-02 when GHL-DOC is retired", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1" }],
    templates: [{
      org_id: "org-1",
      template_key: "SMS-DOC-02-REQUEST-MORE",
      channel: "sms",
      body: "got your upload — one thing needs fixing",
      compliance_passed: true
    }]
  });
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM agents/.test(sql)) {
      return { rows: [{
        code: "GHL-DOC",
        status: "retired",
        prompt: "You are the Document Check agent. Return JSON.",
        output_schema: { outcome: "accept, request_more, or hold" }
      }] };
    }
    return origQuery(sql, params);
  };
  const res = await handle({
    event: ev("docs.received", {
      kind: "client_upload",
      subtype: "bank_statement",
      document_id: "doc-bs"
    }, { clientId: "cl-1" }),
    db,
    loadBytesImpl: async () => ({ buffer: Buffer.from("pdf"), mimeType: "application/pdf" }),
    callModelImpl: async () => ({
      mode: "live",
      text: JSON.stringify({ outcome: "request_more", message_to_client: "need a clearer shot" }),
      error: null
    }),
    recordRunImpl: async () => null
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "ghl_doc_retired");
  assert.equal(db.messages.length, 0);
});

test("docs.received for an inquiry_doc does not run GHL-DOC", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1" }] });
  const res = await handle({
    event: ev("docs.received", {
      kind: "inquiry_doc",
      subtype: "id_document",
      document_id: "doc-inq"
    }, { clientId: "cl-1" }),
    db
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_ghl_doc_kind");
});

test("docs.received for a client bank_statement runs GHL-DOC and routes hold without client messages", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1" }] });
  const origQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/FROM agents/.test(sql)) {
      return { rows: [{
        code: "GHL-DOC",
        prompt: "You are the Document Check agent. Return JSON.",
        output_schema: { outcome: "accept, request_more, or hold" }
      }] };
    }
    return origQuery(sql, params);
  };
  const res = await handle({
    event: ev("docs.received", {
      kind: "client_upload",
      subtype: "bank_statement",
      document_id: "doc-bs"
    }, { clientId: "cl-1" }),
    db,
    loadBytesImpl: async () => ({ buffer: Buffer.from("pdf"), mimeType: "application/pdf" }),
    callModelImpl: async () => ({
      mode: "shadow",
      text: JSON.stringify({ outcome: "hold", hold_reason: "needs a person" }),
      error: null
    }),
    recordRunImpl: async () => null
  });
  assert.equal(res.done, true);
  assert.equal(res.routed, true);
  assert.equal(res.json.outcome, "hold");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 1);
});
