// Identity-packet completeness for inquiry-removal cases.
//
// Required: government photo ID, proof of address, signed authorization.
// SSN card is required only when the dispute includes SSN-related PII.

import { KINDS } from "../documents/kinds.mjs";

export const PACKET_SUBTYPES = Object.freeze({
  ID: "id_document",
  SSN: "ssn_card",
  PROOF_OF_ADDRESS: "proof_of_address",
  BANK_STATEMENT: "bank_statement",
  AUTHORIZATION: "soft_pull_consent"
});

/** Contact-field hold reasons that block funding work (round_hold_reason). */
export const FUNDING_DOC_HOLD = "Documents Pending Approval";
export const FUNDING_PAUSED_HOLD = "Funding Paused";
export const BLOCKING_FUNDING_HOLDS = Object.freeze([
  FUNDING_DOC_HOLD,
  FUNDING_PAUSED_HOLD
]);

export function isBlockingFundingHold(reason) {
  return BLOCKING_FUNDING_HOLDS.includes(String(reason || ""));
}

/**
 * @param {object[]} documents  rows with { kind, subtype }
 * @param {{ requireSsn?: boolean }} [opts]
 * @returns {{ complete: boolean, missing: string[], present: object }}
 */
export function checkDocPacket(documents, opts = {}) {
  const rows = Array.isArray(documents) ? documents : [];
  const bySubtype = new Set(
    rows
      .filter((d) => d && (d.kind === KINDS.CLIENT_UPLOAD || d.kind === KINDS.AUTHORIZATION || d.kind === "client_upload" || d.kind === "authorization"))
      .map((d) => String(d.subtype || ""))
  );

  const hasId = bySubtype.has(PACKET_SUBTYPES.ID);
  const hasAddress =
    bySubtype.has(PACKET_SUBTYPES.PROOF_OF_ADDRESS) ||
    bySubtype.has(PACKET_SUBTYPES.BANK_STATEMENT);
  const hasAuth =
    bySubtype.has(PACKET_SUBTYPES.AUTHORIZATION) ||
    rows.some((d) => d && d.kind === KINDS.AUTHORIZATION);
  const hasSsn = bySubtype.has(PACKET_SUBTYPES.SSN);

  const missing = [];
  if (!hasId) missing.push(PACKET_SUBTYPES.ID);
  if (!hasAddress) missing.push(PACKET_SUBTYPES.PROOF_OF_ADDRESS);
  if (!hasAuth) missing.push("authorization");
  if (opts.requireSsn && !hasSsn) missing.push(PACKET_SUBTYPES.SSN);

  return {
    complete: missing.length === 0,
    missing,
    present: {
      id_document: hasId,
      proof_of_address: hasAddress,
      authorization: hasAuth,
      ssn_card: hasSsn
    }
  };
}

/** True when any staged/disputed PII item is SSN-related. */
export function disputeNeedsSsn(items = []) {
  return (Array.isArray(items) ? items : []).some((it) => {
    const cat = String(it?.category || it?.kind || "").toLowerCase();
    const name = String(it?.inquiry_name || it?.value || "").toLowerCase();
    return cat.includes("ssn") || name.includes("ssn") || name.includes("social security");
  });
}

export async function loadClientDocuments(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, kind, subtype, title, generated_at
       FROM documents
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY generated_at DESC`,
    [orgId, clientId]
  );
  return r.rows;
}

/**
 * Evaluate the packet for a client given disputable items.
 */
export async function evaluateDocGate(db, { orgId, clientId, items = [] }) {
  const docs = await loadClientDocuments(db, { orgId, clientId });
  return checkDocPacket(docs, { requireSsn: disputeNeedsSsn(items) });
}
