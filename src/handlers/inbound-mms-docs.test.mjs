import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onInboundMmsDocs,
  classifyMmsImage,
  subtypeFromAgentJson,
  FALLBACK_SUBTYPE
} from "./inbound-mms-docs.mjs";

test("inbound MMS with no media is a no-op", async () => {
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: { channel: "sms", from: "+15551234567", mediaUrls: [] }
  }, {});
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_media");
});

test("inbound MMS does not mint a client", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM1",
      mediaUrls: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }]
    }
  }, db);
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
});

test("the agent's own words become the subtype", () => {
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["Driver's License"] }), "id_document");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["passport"] }), "id_document");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["utility bill"] }), "proof_of_address");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["Bank statement"] }), "bank_statement");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["Social Security card"] }), "ssn_card");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["pay stub"] }), "proof_of_income");
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["2024 tax return"] }), "tax_return");
});

test("an unclear or two-sided answer stays other — never a guess", () => {
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["unknown"] }), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["a photo of a dog"] }), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["driver's license and a utility bill"] }), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson(null), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson({}), FALLBACK_SUBTYPE);
});

test("no document agent on file means other, not a filename guess", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const res = await classifyMmsImage(db, {
    orgId: "org-1",
    buffer: Buffer.from("img"),
    mimeType: "image/jpeg",
    callModelImpl: async () => { throw new Error("must not be called"); }
  });
  assert.equal(res.subtype, FALLBACK_SUBTYPE);
  assert.equal(res.reason, "agent_unavailable");
});

test("the seeded agent classifies the photo and the document is filed under it", async () => {
  const db = {
    query: async () => ({ rows: [{ code: "GHL-DOC", prompt: "INSTRUCTIONS ...", status: "draft" }] })
  };
  const res = await classifyMmsImage(db, {
    orgId: "org-1",
    buffer: Buffer.from("img"),
    mimeType: "image/jpeg",
    callModelImpl: async () => ({ text: '{"documents_reviewed":["Arizona driver license"]}', mode: "live" })
  });
  assert.equal(res.subtype, "id_document");
  assert.equal(res.reason, "classified");
});

test("a texted ID lands as id_document, not other", async () => {
  const emitted = [];
  const filed = [];
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM9",
      mediaUrls: [{ url: "https://api.twilio.com/media/9", contentType: "image/jpeg" }]
    }
  }, {}, {
    downloadImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/jpeg" }),
    classifyImpl: async () => ({ subtype: "id_document", reason: "classified" }),
    registerImpl: async (_db, _store, args) => {
      filed.push(args);
      return {
        document: { id: "d9", kind: "client_upload", subtype: args.subtype },
        version: { id: "v9", version: 1, mime_type: "image/jpeg", byte_size: 3, checksum: "abc" }
      };
    },
    emitImpl: async (_db, name, payload) => { emitted.push({ name, payload }); return { id: "e9" }; }
  });
  assert.equal(res.done, true);
  assert.deepEqual(res.subtypes, ["id_document"]);
  assert.equal(filed[0].subtype, "id_document");
  assert.equal(filed[0].metadata.classified_by, "GHL-DOC");
  // Never from the filename — the filename says nothing but the message id.
  assert.equal(filed[0].filename, "mms-SM9-0");
  assert.equal(emitted[0].payload.subtype, "id_document");
});

test("inbound MMS stores a client_upload and emits docs.received", async () => {
  const emitted = [];
  const res = await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM1",
      mediaUrls: [{ url: "https://api.twilio.com/media/1", contentType: "image/jpeg" }]
    }
  }, {}, {
    downloadImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/jpeg" }),
    registerImpl: async () => ({
      document: { id: "d1", kind: "client_upload", subtype: "other" },
      version: { id: "v1", version: 1, mime_type: "image/jpeg", byte_size: 3, checksum: "abc" }
    }),
    emitImpl: async (_db, name, payload) => {
      emitted.push({ name, payload });
      return { id: "e1" };
    }
  });
  assert.equal(res.done, true);
  assert.deepEqual(res.documents, ["d1"]);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].name, "docs.received");
  assert.equal(emitted[0].payload.kind, "client_upload");
  assert.equal(emitted[0].payload.subtype, "other");
});
