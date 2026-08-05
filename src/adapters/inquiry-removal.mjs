// Inquiry Removal AI → platform bridge webhook.
//
// The IRA runtime (github.com/ZootimusMaximusBackup/inquiry-removal-ai) today
// writes only to Airtable. This adapter is the signed inbound door that runtime
// should POST to so the CRM desk and Client Control Panel see live case state.
//
// Contract (same three responsibilities as commas/bland, plus domain writes —
// there is no separate handler yet for these events):
//   1. verify HMAC-SHA256 signature (fail-closed)
//   2. normalize the body into a flat event
//   3. write inquiry_removal_cases / inquiry_log, and emit inquiry.removed when
//      a case clears
//
// Event types the IRA side should send (documented in docs/STILL-MISSING.md):
//   case.created | call_state.changed | inquiry.cleared | case.closed
//
// Header: x-inquiry-removal-signature
// Env:    INQUIRY_REMOVAL_WEBHOOK_SECRET

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";
import {
  upsertCase,
  updateCallState,
  clearInquiry,
  closeCase,
  InquiryCaseError
} from "../inquiry-removal/cases.mjs";

export const SIGNATURE_HEADER = "x-inquiry-removal-signature";
export const SECRET_ENV = "INQUIRY_REMOVAL_WEBHOOK_SECRET";

export const EVENT_TYPES = new Set([
  "case.created",
  "call_state.changed",
  "inquiry.cleared",
  "case.closed"
]);

export function verifyInquiryRemovalSignature(rawBody, providedHeader, secret) {
  if (!secret) return false;
  const provided = String(providedHeader || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function normalizeInquiryRemovalEvent(body) {
  const b = body || {};
  const type = String(b.type || b.event || b.event_type || "").toLowerCase();
  return {
    type,
    id: b.id || b.event_id || null,
    orgId: b.org_id || b.orgId || null,
    clientId: b.client_id || b.clientId || null,
    caseId: b.case_id || b.caseId || null,
    externalCaseId: b.external_case_id || b.externalCaseId || b.airtable_case_id || null,
    inquiryId: b.inquiry_id || b.inquiryId || null,
    externalInquiryId: b.external_inquiry_id || b.externalInquiryId || null,
    caseStatus: b.case_status || b.caseStatus || null,
    masterCallState: b.master_call_state || b.masterCallState || b.call_state || b.callState || null,
    selectedBureausRaw: b.selected_bureaus_raw || b.selectedBureausRaw || null,
    requestedBy: b.requested_by || b.requestedBy || null,
    requestedAt: b.requested_at || b.requestedAt || null,
    holdStartedAt: b.hold_started_at || b.holdStartedAt || null,
    liveAgentReachedAt: b.live_agent_reached_at || b.liveAgentReachedAt || null,
    repHandoffAt: b.rep_handoff_at || b.repHandoffAt || null,
    lastDtmfPath: b.last_dtmf_path || b.lastDtmfPath || null,
    callOutcomeSummary: b.call_outcome_summary || b.callOutcomeSummary || b.summary || null,
    attemptCount: b.attempt_count ?? b.attemptCount ?? null,
    callBatchId: b.call_batch_id || b.callBatchId || null,
    voiceProvider: b.voice_provider || b.voiceProvider || null,
    removerNotes: b.remover_notes || b.removerNotes || null,
    bureau: b.bureau || null,
    inquiryName: b.inquiry_name || b.inquiryName || b.inquiry || null,
    inquiries: Array.isArray(b.inquiries) ? b.inquiries : [],
    asCleared: !!(b.as_cleared ?? b.asCleared ?? b.cleared),
    reason: b.reason || b.closed_reason || null,
    fraudAlert: !!(b.fraud_alert ?? b.fraudAlert),
    payload: b
  };
}

async function emitRemoved(db, { clientId, orgId, caseRow, inquiry, evt, rawBody }) {
  const idem = evt.id
    ? `inquiry-removal:${evt.id}:inquiry.removed`
    : `inquiry-removal:body:${crypto.createHash("sha256").update(rawBody || "").digest("hex")}:inquiry.removed`;
  const res = await emit(db, "inquiry.removed", {
    source: "inquiry-removal",
    caseId: caseRow?.id || evt.caseId || null,
    externalCaseId: caseRow?.external_case_id || evt.externalCaseId || null,
    inquiryId: inquiry?.id || evt.inquiryId || null,
    fraudAlert: evt.fraudAlert
  }, {
    idempotencyKey: idem,
    clientId: clientId || caseRow?.client_id || evt.clientId || undefined,
    orgId: orgId || caseRow?.org_id || evt.orgId || undefined
  });
  return { name: "inquiry.removed", id: res.id, deduped: res.deduped };
}

/**
 * handleInquiryRemovalWebhook({ db, rawBody, signatureHeader, secret })
 */
export async function handleInquiryRemovalWebhook({ db, rawBody, signatureHeader, secret }) {
  if (!verifyInquiryRemovalSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [], case: null };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [], case: null };
  }

  const evt = normalizeInquiryRemovalEvent(body);
  if (!EVENT_TYPES.has(evt.type)) {
    return { ok: true, status: 200, reason: `ignored:${evt.type || "unknown"}`, emitted: [], case: null };
  }

  const emitted = [];
  try {
    if (evt.type === "case.created") {
      if (!evt.clientId) {
        return { ok: false, status: 400, reason: "client_id_required", emitted: [], case: null };
      }
      const caseRow = await upsertCase(db, evt);
      return { ok: true, status: 200, reason: "case.created", emitted, case: caseRow };
    }

    if (evt.type === "call_state.changed") {
      const caseRow = await updateCallState(db, evt);
      return { ok: true, status: 200, reason: "call_state.changed", emitted, case: caseRow };
    }

    if (evt.type === "inquiry.cleared") {
      const { inquiry, caseRow, caseCleared } = await clearInquiry(db, evt);
      if (caseCleared) {
        emitted.push(await emitRemoved(db, {
          clientId: inquiry.client_id,
          orgId: inquiry.org_id,
          caseRow,
          inquiry,
          evt,
          rawBody
        }));
      }
      return {
        ok: true, status: 200, reason: "inquiry.cleared",
        emitted, case: caseRow, inquiry, caseCleared
      };
    }

    if (evt.type === "case.closed") {
      const { caseRow, caseCleared } = await closeCase(db, {
        ...evt,
        asCleared: evt.asCleared || evt.caseStatus === "Cleared"
      });
      if (caseCleared) {
        emitted.push(await emitRemoved(db, {
          clientId: caseRow.client_id,
          orgId: caseRow.org_id,
          caseRow,
          inquiry: null,
          evt,
          rawBody
        }));
      }
      return { ok: true, status: 200, reason: "case.closed", emitted, case: caseRow, caseCleared };
    }
  } catch (err) {
    if (err instanceof InquiryCaseError) {
      return { ok: false, status: err.status, reason: err.message, emitted: [], case: null };
    }
    throw err;
  }

  return { ok: true, status: 200, reason: "noop", emitted, case: null };
}
