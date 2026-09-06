// Send gate — nothing leaves until the remover presses send.
//
// COMPLIANCE REVIEW REQUIRED: dispute letter / portal delivery initiation.
//
// Writes letter/portal inquiry_attempts only on this path. Does not call Lob
// here (W4 provider). Portal path REQUIRES a confirmation reference.

import { evaluateDocGate } from "./doc-gate.mjs";
import { logAttempt } from "../inquiries/work.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { scheduleFromDelivery } from "./call-scheduler.mjs";

export class SendGateError extends Error {
  constructor(message, { status = 400, code = "send_gate", missing = null } = {}) {
    super(message);
    this.name = "SendGateError";
    this.status = status;
    this.code = code;
    /* What is still needed, when the refusal is the doc gate. Null on every
       other refusal. The screen prints these words; "incomplete" on its own
       tells the person nothing they can act on. */
    this.missing = missing;
  }
}

/** Plain words for the papers still missing. Never a code, never a dash. */
const DOC_WORDS = Object.freeze({
  id_document: "government photo identification",
  proof_of_address: "proof of address",
  authorization: "signed authorization",
  ssn_card: "Social Security card"
});

export function missingPacketMessage(missing) {
  const words = (Array.isArray(missing) ? missing : [])
    .filter(Boolean)
    .map((m) => DOC_WORDS[m] || String(m).replace(/_/g, " "));
  if (!words.length) return "Identity packet incomplete — send disabled.";
  return "Send disabled — this client's identity packet is still missing: "
    + words.join(", ") + ".";
}

/**
 * Ensure inquiry_log rows exist for the case's bureau items (from prep / open log).
 * Returns inquiry ids to attach attempts to.
 */
export async function ensureCaseInquiries(db, caseRow) {
  const bureau = caseRow.selected_bureaus_raw;
  const orgId = caseRow.org_id;
  const clientId = caseRow.client_id;

  const existing = await db.query(
    `SELECT id FROM inquiry_log
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND bureau = $3
        AND is_open = true`,
    [orgId, clientId, bureau]
  );
  if (existing.rows.length) {
    await db.query(
      `UPDATE inquiry_log
          SET inquiry_removal_case_id = $2
        WHERE id = ANY($1::uuid[])
          AND inquiry_removal_case_id IS NULL`,
      [existing.rows.map((r) => r.id), caseRow.id]
    );
    return existing.rows.map((r) => r.id);
  }

  const prep = await db.query(
    `SELECT * FROM inquiry_prep
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND bureau = $3
        AND prep_state IN ('staging', 'Ready for Cleanup')
      ORDER BY created_at ASC`,
    [orgId, clientId, bureau]
  );

  const ids = [];
  for (const row of prep.rows) {
    const ins = await db.query(
      `INSERT INTO inquiry_log (
         org_id, client_id, bureau, inquiry, inquiry_name, status, call_state,
         attempt_count, is_open, inquiry_removal_case_id
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $4, 'open', 'not_started',
         0, true, $5::uuid
       ) RETURNING id`,
      [orgId, clientId, bureau, row.inquiry_name || "Disputed item", caseRow.id]
    );
    ids.push(ins.rows[0].id);
    await db.query(
      `UPDATE inquiry_prep
          SET prep_state = 'promoted'::inquiry_prep_state,
              promoted_inquiry_record = $2::uuid,
              updated_at = now()
        WHERE id = $1`,
      [row.id, ins.rows[0].id]
    );
  }

  if (!ids.length) {
    // Case with open_inquiry_count but no prep/log — still need a carrier row
    // for the attempt trail.
    const ins = await db.query(
      `INSERT INTO inquiry_log (
         org_id, client_id, bureau, inquiry, inquiry_name, status, call_state,
         attempt_count, is_open, inquiry_removal_case_id
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $4, 'open', 'not_started',
         0, true, $5::uuid
       ) RETURNING id`,
      [orgId, clientId, bureau, `${bureau} dispute packet`, caseRow.id]
    );
    ids.push(ins.rows[0].id);
  }
  return ids;
}

/**
 * Remover send action.
 *
 * @param {object} opts
 * @param {string} opts.caseId
 * @param {string} opts.staffId
 * @param {string} opts.orgId
 * @param {boolean} [opts.mail] — mail via PostGrid (provider-agnostic sender)
 * @param {boolean} [opts.portal] — Experian portal only
 * @param {string|null} [opts.portalConfirmation] — REQUIRED when portal
 * @param {string|null} [opts.portalUploadedAt] — upload timestamp
 * @param {function} [opts.mailSender] — injected W4 provider; optional in W2
 */
export async function sendCase(db, {
  caseId,
  staffId,
  orgId,
  mail = false,
  portal = false,
  portalConfirmation = null,
  portalUploadedAt = null,
  mailSender = null,
  note = null
} = {}) {
  if (!caseId || !staffId || !orgId) {
    throw new SendGateError("caseId, staffId, and orgId are required", { status: 400 });
  }
  if (!mail && !portal) {
    throw new SendGateError("select mail and/or portal delivery", { code: "no_channel" });
  }

  const caseR = await db.query(
    `SELECT * FROM inquiry_removal_cases
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [caseId, orgId]
  );
  const caseRow = caseR.rows[0];
  if (!caseRow) throw new SendGateError("case not found", { status: 404, code: "not_found" });

  const bureau = String(caseRow.selected_bureaus_raw || "").toUpperCase();
  if (portal && bureau !== "EX") {
    throw new SendGateError("portal upload is Experian-only", { code: "portal_ex_only" });
  }
  if (portal) {
    const ref = String(portalConfirmation || "").trim();
    if (!ref) {
      throw new SendGateError("Experian portal reference number is required", {
        code: "portal_confirmation_required"
      });
    }
  }

  /* ── BLOCKED IS A READING, NOT A SENTENCE ────────────────────────────────
     Until 2026-09-06 this refused on `case_status === "Blocked"` BEFORE it
     looked at the packet, and nothing else in the send path ever wrote the
     status back down. So a case blocked once was blocked forever: an agent
     watched the "still needed" list fall from three items to one as the client
     uploaded, and Send stayed grey. The only unblock in the codebase is
     src/handlers/inquiry-docs.mjs, which runs off a `docs.received` event — and
     a signature captured through api/consent/capture.mjs raises no such event,
     so the paper that arrived by the signing door never reached it at all.

     Blocked only ever MEANS "the packet was short the last time somebody
     looked" — src/handlers/inquiry-gate.mjs writes it from exactly this same
     check, and nothing else writes it. So the packet is what decides, and the
     stored status is refreshed to match whichever way it comes out. Short
     packet still refuses, and still refuses with 409 docs_blocked; the
     difference is that a complete one is now allowed to clear the block. */
  const packet = await evaluateDocGate(db, {
    orgId,
    clientId: caseRow.client_id,
    items: []
  });
  if (!packet.complete) {
    await db.query(
      `UPDATE inquiry_removal_cases
          SET case_status = 'Blocked'::inquiry_case_status, updated_at = now()
        WHERE id = $1`,
      [caseId]
    );
    throw new SendGateError(
      missingPacketMessage(packet.missing),
      { status: 409, code: "docs_blocked", missing: packet.missing }
    );
  }
  if (caseRow.case_status === "Blocked") {
    /* The papers are all in. Lift the block in its own statement so the trail
       shows the case unblocking, rather than jumping straight to In Progress
       from a status that no longer described it. */
    await db.query(
      `UPDATE inquiry_removal_cases
          SET case_status = 'Queued'::inquiry_case_status, updated_at = now()
        WHERE id = $1
          AND case_status = 'Blocked'::inquiry_case_status`,
      [caseId]
    );
  }

  const inquiryIds = await ensureCaseInquiries(db, caseRow);
  const attempts = [];

  if (mail) {
    let providerId = null;
    let mailOutcome = "queued_for_delivery";
    if (typeof mailSender === "function") {
      const sent = await mailSender({ caseRow, inquiryIds });
      providerId = sent?.providerId || sent?.id || null;
      mailOutcome = sent?.outcome || "sent";
    }
    for (const inquiryId of inquiryIds) {
      const updated = await logAttempt(db, {
        inquiryId,
        staffId,
        orgId,
        kind: "letter",
        outcome: mailOutcome,
        note: note || (providerId ? `provider:${providerId}` : "mail send requested")
      });
      attempts.push({ kind: "letter", inquiryId, inquiry: updated });
    }
    if (providerId) {
      await db.query(
        `UPDATE inquiry_removal_cases
            SET letter_provider_id = $2, updated_at = now()
          WHERE id = $1`,
        [caseId, String(providerId)]
      );
    }
  }

  if (portal) {
    const ref = String(portalConfirmation).trim();
    const uploadedAt = portalUploadedAt ? new Date(portalUploadedAt) : new Date();
    for (const inquiryId of inquiryIds) {
      const updated = await logAttempt(db, {
        inquiryId,
        staffId,
        orgId,
        kind: "portal",
        outcome: "uploaded",
        note: `experian_ref:${ref}`
      });
      attempts.push({ kind: "portal", inquiryId, inquiry: updated });
    }
    await db.query(
      `UPDATE inquiry_removal_cases
          SET portal_confirmation = $2,
              case_status = 'In Progress'::inquiry_case_status,
              updated_at = now()
        WHERE id = $1`,
      [caseId, ref]
    );
    // Portal upload timestamp starts the call clock if it lands first.
    await scheduleFromDelivery(db, {
      caseId,
      orgId,
      deliveredAt: uploadedAt.toISOString(),
      channel: "portal"
    });
  }

  await db.query(
    `UPDATE inquiry_removal_cases
        SET case_status = 'In Progress'::inquiry_case_status,
            updated_at = now()
      WHERE id = $1`,
    [caseId]
  );

  await moveCardToStage(db, {
    orgId,
    clientId: caseRow.client_id,
    pipelineKey: "inquiry_removal",
    stageKey: "letters_sent"
  });

  const refreshed = (await db.query(
    `SELECT * FROM inquiry_removal_cases WHERE id = $1`,
    [caseId]
  )).rows[0];

  return { case: refreshed, attempts, inquiryIds };
}
