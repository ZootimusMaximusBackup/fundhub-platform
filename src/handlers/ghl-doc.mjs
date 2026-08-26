// GHL-DOC — Document Check.
//
// Seeded in db/migrations/114_ghl_agent_seed.sql against the GHL-era tag
// docs:uploaded. Nothing raises that tag. This module retriggers the seeded
// agent on docs.received for client identity / business document types.
//
// src/handlers/inquiry-docs.mjs also listens to docs.received for the inquiry
// gate. Discriminate on document type: inquiry_doc stays on that path.
// Spec 4.6 routes accept / request_more / hold here.

import { byCode } from "../agents/registry.mjs";
import { callModel } from "../agents/model.mjs";
import { recordRun } from "../agents/shadow-log.mjs";
import { resolveStorageTarget } from "../documents/retrieve.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { mediaFromBytes } from "../repair/response-agent.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags, removeTags } from "../workflows/tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { FUNDING_DOC_HOLD } from "../inquiry-ops/doc-gate.mjs";

export const AGENT_CODE = "GHL-DOC";
export const EMAIL_DOC_03 = "EMAIL-DOC-03-APPROVED";
export const SMS_DOC_03 = "SMS-DOC-03-APPROVED";
export const SMS_DOC_02 = "SMS-DOC-02-REQUEST-MORE";

export const GHL_DOC_TYPES = Object.freeze([
  "id_document",
  "proof_of_address",
  "articles_of_organization",
  "ssn_card",
  "proof_of_income",
  "bank_statement"
]);

export function shouldRunGhlDoc(payload) {
  const p = payload || {};
  const hardKind = String(p.kind || "");
  if (hardKind === "inquiry_doc" || hardKind === "bureau_response") return false;
  if (hardKind === "client_upload") return true;
  const names = [p.kind, p.subtype].filter(Boolean).map(String);
  return GHL_DOC_TYPES.some((t) => names.includes(t));
}

async function loadDocumentBytes(db, { documentId, versionId = null, store = null }) {
  const target = await resolveStorageTarget(db, { documentId, versionId });
  if (!target?.storage_key) return null;
  const s = store || storeFromEnv();
  const got = await s.get(target.storage_key);
  if (!got?.body) return null;
  return { buffer: got.body, mimeType: got.contentType || target.mime_type || "application/octet-stream" };
}

export async function routeGhlDocOutcome(db, { orgId, clientId, eventId, json }) {
  const outcome = String(json?.outcome || "").trim().toLowerCase();
  if (!outcome) return { routed: false, reason: "no_outcome" };

  if (outcome === "accept") {
    const hold = await db.query(`SELECT custom_fields FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
    const reason = hold.rows[0]?.custom_fields?.round_hold_reason;
    const patch = {
      employee_next_action: "Optimize Profile",
      doc_agent_message: null
    };
    if (reason === FUNDING_DOC_HOLD) patch.round_hold_reason = null;
    await mergeCustomFields(db, clientId, patch);
    await removeTags(db, clientId, ["docs:missing"]);
    const email = await sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_DOC_03, eventId: `${eventId}:doc-03e`
    });
    const sms = await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_DOC_03, eventId: `${eventId}:doc-03s`
    });
    return { routed: true, outcome, email, sms };
  }

  if (outcome === "request_more") {
    const message = json.message_to_client || json.messageToClient || null;
    await mergeCustomFields(db, clientId, { doc_agent_message: message });
    const sms = await sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_DOC_02, eventId: `${eventId}:doc-02s`
    });
    return { routed: true, outcome, sms, gate: "closed" };
  }

  if (outcome === "hold") {
    const holdReason = json.hold_reason || json.holdReason || "needs review";
    const task = await createTask(db, {
      orgId,
      clientId,
      title: `Document hold — ${holdReason}`,
      sourceWorkflow: "ghl-doc-document-check",
      assigneeRole: "closer",
      eventId,
      body: String(holdReason)
    });
    return { routed: true, outcome, task, gate: "closed" };
  }

  return { routed: false, reason: "unknown_outcome", outcome };
}

export async function onDocsReceivedGhlDoc(db, event, deps = {}) {
  const {
    env = process.env,
    fetchImpl,
    callModelImpl = callModel,
    loadBytesImpl = null,
    recordRunImpl = recordRun,
    routeImpl = routeGhlDocOutcome
  } = deps;

  const payload = event?.payload || {};
  if (!shouldRunGhlDoc(payload)) {
    return { done: false, reason: "not_ghl_doc_kind" };
  }

  const orgId = event.orgId || payload.org_id || payload.orgId;
  const clientId = event.clientId || payload.client_id || payload.clientId;
  const documentId = payload.document_id || payload.documentId;
  if (!orgId || !clientId || !documentId) {
    return { done: false, reason: "missing_docs_received_fields" };
  }

  const agent = await byCode(db, { orgId, code: AGENT_CODE });
  if (!agent || !String(agent.prompt || "").trim()) {
    return { done: false, reason: "ghl_doc_unavailable" };
  }
  // Retired Document Check must not queue SMS-DOC-02 (or DOC-03). Status is
  // the same switch the rest of the agent runtime already honors.
  const status = String(agent.status || "");
  if (status === "retired" || status === "draft") {
    return { done: false, reason: status === "retired" ? "ghl_doc_retired" : "ghl_doc_not_live" };
  }

  const loaded = await (loadBytesImpl || loadDocumentBytes)(db, {
    documentId,
    versionId: payload.version_id || payload.versionId || null
  });
  if (!loaded?.buffer) {
    await recordRunImpl(db, {
      orgId, agentCode: AGENT_CODE, clientId,
      triggerEvent: "docs.received", eventId: event.id || null,
      channel: "internal", outcome: "document_bytes_missing"
    });
    return { done: false, reason: "document_bytes_missing" };
  }

  const schema = agent.output_schema
    ? (typeof agent.output_schema === "string" ? agent.output_schema : JSON.stringify(agent.output_schema))
    : '{"outcome":"accept|request_more|hold"}';
  const docType = payload.subtype || payload.kind;
  const modelResult = await callModelImpl({
    system: String(agent.prompt),
    user: [
      `A client uploaded a ${docType} document.`,
      payload.original_filename ? `Filename: ${payload.original_filename}` : "",
      "Read the document image. Reply with ONLY a JSON object matching this schema:",
      schema
    ].filter(Boolean).join("\n"),
    media: mediaFromBytes(loaded.mimeType, loaded.buffer),
    env,
    fetchImpl,
    maxTokens: 2000
  });

  const json = parseAgentJson(modelResult.text);
  await recordRunImpl(db, {
    orgId, agentCode: AGENT_CODE, clientId,
    triggerEvent: "docs.received", eventId: event.id || null,
    channel: "internal",
    mode: modelResult.mode || null,
    outcome: json?.outcome || modelResult.error || "ran",
    detail: String(modelResult.text || modelResult.error || "").slice(0, 500)
  });

  const routed = json
    ? await routeImpl(db, { orgId, clientId, eventId: event.id || documentId, json })
    : { routed: false, reason: "no_json" };

  return {
    done: true,
    agent: AGENT_CODE,
    mode: modelResult.mode || null,
    json,
    routed: routed.routed === true,
    route: routed
  };
}

export function parseAgentJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : s;
  try {
    const obj = JSON.parse(body);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

export default onDocsReceivedGhlDoc;
