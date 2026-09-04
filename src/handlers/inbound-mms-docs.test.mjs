import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onInboundMmsDocs,
  classifyMmsImage,
  subtypeFromAgentJson,
  agentRejectedDocument,
  FALLBACK_SUBTYPE
} from "./inbound-mms-docs.mjs";
import { checkDocPacket } from "../inquiry-ops/doc-gate.mjs";

/** The identity leg of the packet that decides whether letters may be mailed. */
function gateSeesId(subtype) {
  return checkDocPacket([{ kind: "client_upload", subtype }]).present.id_document;
}

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
    // Measured 2026-09-04 on a scratch database with all 239 migrations applied
    // to empty: the seeded DOC-CHECK row's status is 'draft'. Status is ignored
    // here on purpose — filing an image under the right name sends nothing to
    // anybody, so a retired agent naming a document is still safe to believe.
    query: async () => ({ rows: [{ code: "DOC-CHECK", prompt: "INSTRUCTIONS ...", status: "draft" }] })
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
  assert.equal(filed[0].metadata.classified_by, "DOC-CHECK");
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

/* THE LABEL IS NEVER STRONGER THAN THE EVIDENCE.
 *
 * Every phrase below is something the document agent can really say. Each one
 * used to be filed as a government ID, which satisfies the identity leg of
 * src/inquiry-ops/doc-gate.mjs — the gate that decides whether dispute letters
 * may be mailed in a client's name. */
test("a phrase that denies an ID is never filed as one, and the gate stays shut", () => {
  const denials = [
    "No valid ID was visible in this photo",
    "not an ID",
    "the photo is too blurry to read the ID",
    "a selfie, no id card",
    "there is no identification card here",
    "unreadable driver's license",
    "expired driver's license"
  ];
  for (const said of denials) {
    const sub = subtypeFromAgentJson({ documents_reviewed: [said] });
    assert.equal(sub, FALLBACK_SUBTYPE, `should stay other: ${said}`);
    assert.equal(gateSeesId(sub), false, `gate must stay shut: ${said}`);
  }
});

test("a hedged or unsure phrase stays other", () => {
  const hedges = [
    "appears to be a driver's license",
    "possibly a passport",
    "looks like a state id",
    "might be an identification card",
    "either a driver's license or a state id",
    "a driver license belonging to someone other than the client"
  ];
  for (const said of hedges) {
    assert.equal(subtypeFromAgentJson({ documents_reviewed: [said] }), FALLBACK_SUBTYPE, said);
  }
});

test("a sentence about the photo is not a name for it", () => {
  // The agent was asked for the plainest name. Six words or fewer is a name.
  assert.equal(
    subtypeFromAgentJson({ documents_reviewed: ["this is a picture of a government id held up to the camera"] }),
    FALLBACK_SUBTYPE
  );
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["Arizona driver license"] }), "id_document");
});

test("a document the agent did not accept is never typed as a verified identity document", () => {
  assert.equal(agentRejectedDocument({ outcome: "request_more" }), true);
  assert.equal(agentRejectedDocument({ outcome: "hold" }), true);
  assert.equal(agentRejectedDocument({ outcome: "accept" }), false);
  assert.equal(agentRejectedDocument({ issues: ["glare on the front"] }), true);
  assert.equal(agentRejectedDocument({ issues: [] }), false);
  assert.equal(agentRejectedDocument({ issues: ["none"] }), false);
  assert.equal(agentRejectedDocument({ hold_reason: "address does not match" }), true);

  const held = { documents_reviewed: ["driver's license"], outcome: "hold", hold_reason: "address does not match" };
  assert.equal(subtypeFromAgentJson(held), FALLBACK_SUBTYPE);
  assert.equal(gateSeesId(subtypeFromAgentJson(held)), false);

  const flagged = { documents_reviewed: ["driver's license"], issues: ["corners cut off"] };
  assert.equal(subtypeFromAgentJson(flagged), FALLBACK_SUBTYPE);

  const clean = { documents_reviewed: ["driver's license"], outcome: "accept", issues: [] };
  assert.equal(subtypeFromAgentJson(clean), "id_document");
  assert.equal(gateSeesId(subtypeFromAgentJson(clean)), true);
});

test("two phrases must agree, and one unreadable phrase spoils the answer", () => {
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["driver's license", "utility bill"] }), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["driver's license", "a photo of a dog"] }), FALLBACK_SUBTYPE);
  assert.equal(subtypeFromAgentJson({ documents_reviewed: ["driver's license", "driver license"] }), "id_document");
});

test("a photo that stays other is not stamped as the agent's decision", async () => {
  const filed = [];
  await onInboundMmsDocs({
    orgId: "org-1",
    clientId: "cl-1",
    payload: {
      channel: "sms",
      from: "+15550001111",
      sid: "SM7",
      mediaUrls: [{ url: "https://api.twilio.com/media/7", contentType: "image/jpeg" }]
    }
  }, {}, {
    downloadImpl: async () => ({ buffer: Buffer.from("img"), mimeType: "image/jpeg" }),
    classifyImpl: async () => ({ subtype: FALLBACK_SUBTYPE, reason: "unclassified" }),
    registerImpl: async (_db, _store, args) => {
      filed.push(args);
      return {
        document: { id: "d7", kind: "client_upload", subtype: args.subtype },
        version: { id: "v7", version: 1, mime_type: "image/jpeg", byte_size: 3, checksum: "abc" }
      };
    },
    emitImpl: async () => ({ id: "e7" })
  });
  assert.equal(filed[0].subtype, FALLBACK_SUBTYPE);
  assert.equal(filed[0].metadata.classified_by, null);
  assert.equal(filed[0].metadata.classification, "unclassified");
});

test("the classifier's live answer is only as strong as the agent's words", async () => {
  const db = {
    query: async () => ({ rows: [{ code: "DOC-CHECK", prompt: "INSTRUCTIONS ...", status: "retired" }] })
  };
  const run = (text) => classifyMmsImage(db, {
    orgId: "org-1",
    buffer: Buffer.from("img"),
    mimeType: "image/jpeg",
    callModelImpl: async () => ({ text, mode: "live" })
  });

  const clear = await run('{"documents_reviewed":["Arizona driver license"]}');
  assert.equal(clear.subtype, "id_document");
  assert.equal(clear.reason, "classified");
  assert.equal(gateSeesId(clear.subtype), true);

  const denied = await run('{"documents_reviewed":["No valid ID was visible in this photo"]}');
  assert.equal(denied.subtype, FALLBACK_SUBTYPE);
  assert.equal(denied.reason, "unclassified");
  assert.equal(gateSeesId(denied.subtype), false);

  const unsure = await run('{"documents_reviewed":["possibly a passport"]}');
  assert.equal(unsure.subtype, FALLBACK_SUBTYPE);
  assert.equal(unsure.reason, "unclassified");
  assert.equal(gateSeesId(unsure.subtype), false);
});
