// src/contracts/sign.mjs — what happens on the client's side of the link.
//
// Two operations, and one of them is the whole point of this feature:
//
//   viewForSigning()  the words, plus everything the page needs to render.
//   sign()            the signature — and THE TAMPER CHECK.
//
// ── THE TAMPER CHECK ────────────────────────────────────────────────────────
//
// The brief: "store rendered body hash at send, refuse signature if content
// changed after send."
//
// So before a signature is written, this module takes a FRESH sha256 of
// contracts.rendered_body exactly as it stands at that instant and compares it,
// in constant time, against document_versions.checksum — the hash written at
// send into a column 030_documents.sql makes immutable with a database trigger.
// If they differ, nothing is written and the caller gets 409 content_changed.
//
// WHY THE COMPARISON IS AGAINST document_versions AND NOT AGAINST
// contracts.body_sha. Both are frozen by a trigger, so on paper either would do.
// But body_sha and rendered_body live in the same row of the same table behind
// the same trigger: one bad migration that drops trg_contracts_frozen takes out
// the words and their hash together, and the check would pass over altered
// content. document_versions is a different table with an older, independently
// tested guard whose entire purpose is this. Two tables have to be defeated
// instead of one.
//
// A contract with no document_version_id is REFUSED rather than waved through.
// That combination should be impossible — send() always registers before it
// freezes — so if it happens the anchor is missing and there is nothing to check
// the words against. "Cannot verify" and "verified" are not the same answer, and
// on a signature the difference is the entire value of the record.
//
// ── WHAT A SIGNATURE IS HERE ────────────────────────────────────────────────
// Typed name, the exact attestation sentence they ticked, the time, the IP, and
// the browser string. No external e-signature vendor — that was the brief. There
// is no signature_ref because there is no external envelope to reference.

import { createHash, timingSafeEqual } from "node:crypto";
import { markSigned } from "../documents/register.mjs";
import { badRequest, notFound, conflict } from "./errors.mjs";
import { CONTRACT_COLUMNS, getContract, bodyHash, emitContractEvent } from "./send.mjs";

/** Constant-time string compare. A hash comparison is a credential comparison. */
function sameHash(a, b) {
  const x = Buffer.from(String(a ?? ""), "utf8");
  const y = Buffer.from(String(b ?? ""), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * loadForClient — the contract behind a verified link.
 *
 * NO org_id FILTER, and that is correct rather than an oversight: the caller is
 * not signed in and has no org to be scoped to. The credential is the HMAC over
 * the contract id, which the endpoint verifies before calling this. Adding an
 * org filter would require the anonymous caller to name an org, which is an
 * invitation to guess one.
 */
export async function loadForClient(db, contractId) {
  if (!contractId) return null;
  const { rows } = await db.query(
    `SELECT ${CONTRACT_COLUMNS} FROM contracts WHERE id = $1::uuid LIMIT 1`,
    [contractId]);
  return rows[0] || null;
}

/**
 * verifyIntegrity — is what is on the page still what was sent?
 *
 * Returns { ok, reason, expected, actual }. Never throws: an unverifiable
 * contract is a refusal, not a crash.
 */
export async function verifyIntegrity(db, contract) {
  if (!contract) return { ok: false, reason: "not_found" };
  if (!contract.rendered_body) return { ok: false, reason: "no_body" };
  if (!contract.document_version_id) return { ok: false, reason: "no_anchor" };

  const { rows } = await db.query(
    `SELECT checksum FROM document_versions WHERE id = $1::uuid LIMIT 1`,
    [contract.document_version_id]);
  const anchor = rows[0]?.checksum || null;
  if (!anchor) return { ok: false, reason: "no_anchor" };

  const actual = bodyHash(contract.rendered_body);
  if (!sameHash(anchor, actual)) {
    return { ok: false, reason: "content_changed", expected: anchor, actual };
  }
  // The row's own copy of the hash is checked too. It is the weaker of the two
  // guards, but a mismatch here means something wrote to this row outside every
  // supported path, and that is worth refusing over.
  if (contract.body_sha && !sameHash(contract.body_sha, actual)) {
    return { ok: false, reason: "content_changed", expected: contract.body_sha, actual };
  }
  return { ok: true, reason: null, expected: anchor, actual };
}

/* What the signing page is allowed to know. Deliberately NOT the whole row:
   sent_by, created_by, org_id and the document ids are internal and go nowhere
   near an anonymous caller. */
function shapeForClient(contract, { integrity } = {}) {
  return {
    id: contract.id,
    title: contract.title,
    kind: contract.kind,
    subtype: contract.subtype,
    status: contract.status,
    body: contract.rendered_body,
    signature_required: contract.signature_required,
    signature_statement: contract.signature_statement,
    sent_at: contract.sent_at,
    signed_at: contract.signed_at,
    signer_name: contract.signer_name,
    // The page needs to know whether the Sign button can work at all, so it can
    // say so up front instead of letting somebody type their name and then fail.
    can_sign: contract.status === "sent" || contract.status === "viewed",
    verified: integrity ? integrity.ok === true : null
  };
}

/**
 * viewForSigning — the client opened the link.
 *
 * Records the view (first time stamps viewed_at, every time bumps view_count)
 * and returns the words. A draft or a voided contract is NOT shown — a draft has
 * no body at all, and showing a voided contract invites somebody to sign
 * something that has been withdrawn.
 *
 * A signed contract IS shown, and that is the brief's "both parties can retrieve
 * a copy": the same link keeps working afterwards and renders the signed
 * document with the signature on it.
 */
export async function viewForSigning(db, { contractId, at = new Date() } = {}) {
  const contract = await loadForClient(db, contractId);
  if (!contract) throw notFound();
  if (contract.status === "draft") throw notFound();
  if (contract.status === "void") {
    throw conflict(
      "This document has been withdrawn and can no longer be signed. " +
      "Please contact the person who sent it to you.",
      "voided");
  }

  const integrity = await verifyIntegrity(db, contract);

  /* The view is recorded even when integrity fails. Somebody opening a tampered
     contract is precisely the event worth having a timestamp for. */
  const { rows } = await db.query(
    `UPDATE contracts
        SET view_count = view_count + 1,
            viewed_at  = COALESCE(viewed_at, $2),
            status     = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
            updated_at = now()
      WHERE id = $1::uuid
      RETURNING ${CONTRACT_COLUMNS}`,
    [contract.id, at]);
  const fresh = rows[0] || contract;

  return { contract: shapeForClient(fresh, { integrity }), integrity };
}

/**
 * sign — the signature.
 *
 * Order matters and is not negotiable:
 *   1. the contract exists and is in a state that can be signed
 *   2. the typed name is really a name
 *   3. the checkbox was really ticked
 *   4. THE WORDS HAVE NOT CHANGED  ← refuse here, before anything is written
 *   5. write the signature, conditionally on it still being unsigned
 *   6. mirror onto document_versions, emit contract.signed
 */
export async function sign(db, {
  contractId, signerName, agreed, ip = null, userAgent = null, at = new Date()
} = {}) {
  const contract = await loadForClient(db, contractId);
  if (!contract) throw notFound();

  if (contract.status === "draft") throw notFound();
  if (contract.status === "void") {
    throw conflict(
      "This document has been withdrawn and can no longer be signed.", "voided");
  }
  if (contract.status === "signed") {
    throw conflict("This document has already been signed.", "already_signed");
  }

  const name = String(signerName ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) {
    throw badRequest("Please type your full name to sign.", "name_required");
  }
  if (name.length > 200) {
    throw badRequest("That name is too long — please type the name you go by.", "name_too_long");
  }
  if (agreed !== true) {
    throw badRequest("Please tick the box to say you agree before signing.", "agreement_required");
  }

  // ── 4. THE TAMPER CHECK ───────────────────────────────────────────────────
  const integrity = await verifyIntegrity(db, contract);
  if (!integrity.ok) {
    if (integrity.reason === "content_changed") {
      throw conflict(
        "This document does not match the copy that was sent to you, so it " +
        "cannot be signed. Nobody has been charged and nothing has been agreed. " +
        "Please contact the person who sent it.",
        "content_changed");
    }
    throw conflict(
      "This document cannot be checked right now, so it cannot be signed. " +
      "Please contact the person who sent it.",
      "unverifiable", integrity.reason);
  }

  // ── 5. write it ───────────────────────────────────────────────────────────
  // Conditional on signed_at still being NULL: two tabs racing must produce one
  // signature, and the loser must be told, not silently overwrite the winner.
  const { rows } = await db.query(
    `UPDATE contracts
        SET status = 'signed', signed_at = $2, signer_name = $3,
            signer_ip = $4, signer_user_agent = $5, updated_at = now()
      WHERE id = $1::uuid AND signed_at IS NULL AND status IN ('sent','viewed')
      RETURNING ${CONTRACT_COLUMNS}`,
    [contract.id, at, name, ip == null ? null : String(ip).slice(0, 100),
     userAgent == null ? null : String(userAgent).slice(0, 500)]);

  if (!rows[0]) {
    throw conflict("This document has already been signed.", "already_signed");
  }
  const signed = rows[0];

  // ── 6. mirror + emit ──────────────────────────────────────────────────────
  // signature_ref stays NULL: it is the column for an EXTERNAL e-sign envelope
  // id, and there is no external vendor here. Writing something else into it
  // would make an audit of documents/ report an integration that does not exist.
  if (signed.document_id) {
    await markSigned(db, {
      documentId: signed.document_id,
      versionId: signed.document_version_id || null,
      signerName: name,
      signedAt: at
    }).catch((err) => {
      console.warn(`[contracts] could not mirror the signature onto documents: ${err.message}`);
    });
  }

  await emitContractEvent(db, "contract.signed", signed);

  return { contract: shapeForClient(signed, { integrity }), record: signed };
}

/**
 * signedCopyHash — the number a person can be given to prove their copy is the
 * one on file. Exposed so the CRM and the signing page can both print it.
 */
export const signedCopyHash = (contract) =>
  contract && contract.rendered_body
    ? createHash("sha256").update(Buffer.from(contract.rendered_body, "utf8")).digest("hex").slice(0, 16)
    : null;
