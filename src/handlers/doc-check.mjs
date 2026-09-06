// DOC-CHECK — Document Check.
//
// Seeded in db/migrations/114_ghl_agent_seed.sql against the GHL-era tag
// docs:uploaded. Nothing raises that tag. This module retriggers the seeded
// agent on docs.received for client identity / business document types.
//
// Renamed from GHL-DOC by db/migrations/310_doc_check_verified_identity.sql:
// GoHighLevel is out (owner, 2026-08-15) and this agent has only ever run on
// Inngest inside this repository.
//
// src/handlers/inquiry-docs.mjs also listens to docs.received for the inquiry
// gate. Discriminate on document type: inquiry_doc stays on that path.
// Spec 4.6 routes accept / request_more / hold here.
//
// WHAT AN ACCEPT NOW DOES. This agent is the only thing in the system that ever
// sees the client's government ID and proof of address. On accept it writes the
// name, address and date of birth it read off those images to
// pii_identity.verified_*, with the document version each field came from, so
// the dispute letters can quote a value a document actually proved instead of
// falling back to the name a closer typed on a sales call. See
// src/identity/verified.mjs.

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
import { extractVerifiedIdentity, recordVerifiedIdentity } from "../identity/verified.mjs";

export const AGENT_CODE = "DOC-CHECK";
export const WORKFLOW_ID = "doc-check";
export const EMAIL_DOC_03 = "EMAIL-DOC-03-APPROVED";
export const SMS_DOC_03 = "SMS-DOC-03-APPROVED";
export const SMS_DOC_02 = "SMS-DOC-02-REQUEST-MORE";

export const DOC_CHECK_TYPES = Object.freeze([
  "id_document",
  "proof_of_address",
  "articles_of_organization",
  "ssn_card",
  "proof_of_income",
  "bank_statement"
]);

export function shouldRunDocCheck(payload) {
  const p = payload || {};
  const hardKind = String(p.kind || "");
  if (hardKind === "inquiry_doc" || hardKind === "bureau_response") return false;
  if (hardKind === "client_upload") return true;
  const names = [p.kind, p.subtype].filter(Boolean).map(String);
  return DOC_CHECK_TYPES.some((t) => names.includes(t));
}

async function loadDocumentBytes(db, { documentId, versionId = null, store = null }) {
  const target = await resolveStorageTarget(db, { documentId, versionId });
  if (!target?.storage_key) return null;
  const s = store || storeFromEnv();
  const got = await s.get(target.storage_key);
  if (!got?.body) return null;
  return {
    buffer: got.body,
    mimeType: got.contentType || target.mime_type || "application/octet-stream",
    // Which exact version of the file the agent is about to read. This is the
    // provenance stamped on every verified field, so it travels with the bytes
    // rather than being looked up again later against a document that may have
    // gained a newer version in between.
    versionId: target.version_id || versionId || null
  };
}

export async function routeDocCheckOutcome(db, {
  orgId, clientId, eventId, json, documentId = null, versionId = null
}) {
  const outcome = String(json?.outcome || "").trim().toLowerCase();
  if (!outcome) return { routed: false, reason: "no_outcome" };

  if (outcome === "accept") {
    // Truth first, then the messages. The verified name and address are what
    // the letters quote; a send that raced ahead of the write would be a client
    // told "you are approved" while the file still carries the closer's typing.
    const read = extractVerifiedIdentity(json);
    let identity;
    try {
      identity = await recordVerifiedIdentity(db, {
        orgId,
        clientId,
        documentId,
        versionId,
        agent: AGENT_CODE,
        legalName: read.legalName,
        address: read.address,
        dateOfBirth: read.dateOfBirth
      });
    } catch (err) {
      // An accept must never end in silence — that is the exact failure
      // db/migrations/267_document_check_live.sql was written to undo. The
      // client still gets told their documents passed; the identity write is
      // reported as failed rather than swallowed.
      identity = { written: false, reason: "write_failed", error: String(err?.message || err) };
    }

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
    return { routed: true, outcome, email, sms, identity };
  }

  if (outcome === "request_more") {
    // Nothing is recorded. A document the agent would not accept has proved
    // nothing, however much of it the model managed to read.
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
      sourceWorkflow: WORKFLOW_ID,
      assigneeRole: "closer",
      eventId,
      body: String(holdReason)
    });
    return { routed: true, outcome, task, gate: "closed" };
  }

  return { routed: false, reason: "unknown_outcome", outcome };
}

/** Plain-English on-file facts for the model. Without this, the seeded prompt
 * claims it "can see" name/address but none were passed — false request_more. */
export function clientContextLines(client) {
  const c = client || {};
  const cf = c.custom_fields && typeof c.custom_fields === "object" ? c.custom_fields : {};
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
    || String(cf.full_name || cf.name || "").trim()
    || "(name not on file)";
  const line1 = String(cf.address_line1 || cf.address || cf.mailing_address || "").trim();
  const city = String(cf.address_city || cf.city || "").trim();
  const state = String(cf.address_state || cf.state || "").trim();
  const zip = String(cf.address_zip || cf.zip || "").trim();
  const addr = [line1, [city, state].filter(Boolean).join(", "), zip].filter(Boolean).join(" ").trim()
    || "(address not on file)";
  const dob = String(cf.dob || cf.date_of_birth || c.dob || "").trim() || "(DOB not on file)";
  const biz = String(cf.business_name || cf.company_name || "").trim() || "(business name not on file)";
  const today = new Date().toISOString().slice(0, 10);
  return [
    `Client on file — full name: ${name}`,
    `Client on file — personal address: ${addr}`,
    `Client on file — DOB: ${dob}`,
    `Client on file — business name: ${biz}`,
    `Today's date (UTC): ${today}. A statement period ending on or before today is not "future-dated".`,
    "You are reviewing ONE uploaded file of the stated type. Judge only that file for that type.",
    "Do not request other document types (for example Articles) when reviewing a single ID, bank statement, or SSN card.",
    "If the address printed on the ID or statement matches the personal address on file (ignore case and punctuation), treat the address as matching.",
    "ZIP+4 extras on an ID (for example 85233-1901 or 85233+1901) still match when street, city, state, and the 5-digit ZIP agree with the address on file.",
    "If this upload is an ssn_card: it is optional support. If the card is legible and the name matches the client on file, outcome must be accept. Never request_more only because an SSN card is not a photo ID or proof of address.",
    "The on-file values above are for MATCHING only. Never copy them into verified_legal_name, verified_address or verified_date_of_birth — those three carry only what is printed on the image, and null when it is not printed there."
  ];
}

export async function onDocsReceivedDocCheck(db, event, deps = {}) {
  const {
    env = process.env,
    fetchImpl,
    callModelImpl = callModel,
    loadBytesImpl = null,
    recordRunImpl = recordRun,
    routeImpl = routeDocCheckOutcome
  } = deps;

  const payload = event?.payload || {};
  if (!shouldRunDocCheck(payload)) {
    return { done: false, reason: "not_doc_check_kind" };
  }

  const orgId = event.orgId || payload.org_id || payload.orgId;
  const clientId = event.clientId || payload.client_id || payload.clientId;
  const documentId = payload.document_id || payload.documentId;
  if (!orgId || !clientId || !documentId) {
    return { done: false, reason: "missing_docs_received_fields" };
  }

  const agent = await byCode(db, { orgId, code: AGENT_CODE });
  if (!agent || !String(agent.prompt || "").trim()) {
    return { done: false, reason: "doc_check_unavailable" };
  }
  // Retired Document Check must not queue SMS-DOC-02 (or DOC-03). Status is
  // the same switch the rest of the agent runtime already honors.
  // Still write an honest agent_runs row so an upload is not a silent skip.
  const status = String(agent.status || "");
  if (status === "retired" || status === "draft") {
    const reason = status === "retired" ? "doc_check_retired" : "doc_check_not_live";
    await recordRunImpl(db, {
      orgId, agentCode: AGENT_CODE, clientId,
      triggerEvent: "docs.received", eventId: event.id || null,
      channel: "internal", outcome: reason
    });
    return { done: false, reason };
  }

  const payloadVersionId = payload.version_id || payload.versionId || null;
  const loaded = await (loadBytesImpl || loadDocumentBytes)(db, {
    documentId,
    versionId: payloadVersionId
  });
  if (!loaded?.buffer) {
    await recordRunImpl(db, {
      orgId, agentCode: AGENT_CODE, clientId,
      triggerEvent: "docs.received", eventId: event.id || null,
      channel: "internal", outcome: "document_bytes_missing"
    });
    return { done: false, reason: "document_bytes_missing" };
  }
  const versionId = loaded.versionId || payloadVersionId || null;

  const clientRow = await db.query(
    `SELECT first_name, last_name, custom_fields FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  ).catch(() => ({ rows: [] }));
  const clientCtx = clientContextLines(clientRow.rows?.[0] || null);

  const schema = agent.output_schema
    ? (typeof agent.output_schema === "string" ? agent.output_schema : JSON.stringify(agent.output_schema))
    : '{"outcome":"accept|request_more|hold"}';
  const docType = payload.subtype || payload.kind;
  const modelResult = await callModelImpl({
    system: String(agent.prompt),
    user: [
      `A client uploaded a ${docType} document.`,
      payload.original_filename ? `Filename: ${payload.original_filename}` : "",
      ...clientCtx,
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
    ? await routeImpl(db, {
        orgId, clientId, eventId: event.id || documentId, json, documentId, versionId
      })
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

export default onDocsReceivedDocCheck;
