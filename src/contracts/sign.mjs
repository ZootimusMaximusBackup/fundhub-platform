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
import { storeFromEnv } from "../documents/store.mjs";
import { storeAndRegister } from "../documents/register.mjs";
import { buildDocumentKey } from "../documents/kinds.mjs";
import { resolveStorageTarget } from "../documents/retrieve.mjs";
import { flatten, textToPdf, PDF_MIME } from "./pdf.mjs";
import {
  fieldsForSigner, openFieldsForSigner, missingForSigner, mergeSignerValues
} from "./fields.mjs";
import {
  listSigners, resolveSigner, canSign, allSigned, markSignerViewed,
  publicSignerList, waitingSummary, SIGNER_COLUMNS
} from "./signers.mjs";

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
function shapeForClient(contract, { integrity, signer = null, signers = [], turn = null } = {}) {
  const mine = signer ? fieldsForSigner(contract.fields || [], signer.signer_index) : [];
  return {
    id: contract.id,
    title: contract.title,
    kind: contract.kind,
    subtype: contract.subtype,
    status: contract.status,
    source_kind: contract.source_kind || "text",
    // TEXT contracts hand over the words. PDF contracts hand over nothing here —
    // the file is fetched separately through its own signed link, so a document
    // that is megabytes long is not inlined into every status poll.
    body: (contract.source_kind || "text") === "text" ? contract.rendered_body : null,
    signature_required: contract.signature_required,
    signature_statement: contract.signature_statement,
    sent_at: contract.sent_at,
    signed_at: contract.signed_at,
    signer_name: contract.signer_name,
    completed_at: contract.completed_at,

    // ── this person ────────────────────────────────────────────────────────
    signer: signer
      ? {
          id: signer.id, index: signer.signer_index, role_label: signer.role_label,
          name: signer.name, status: signer.status,
          signed_at: signer.signed_at, signer_name: signer.signer_name
        }
      : null,
    /* Only their OWN boxes, and the auto-filled ones come with their values so
       the page can show them locked. Somebody else's boxes are not sent at all:
       a counterparty's fee figure is not this signer's business, and a field
       they cannot see is a field they cannot try to change. */
    fields: mine.map((f) => ({
      id: f.id, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h,
      type: f.type, label: f.label, required: f.required,
      locked: f.source !== "manual",
      value: f.source !== "manual" ? f.value : ""
    })),
    // Names and states of everybody, so the page can say who it is waiting for.
    // Never their email addresses or links.
    signers: publicSignerList(signers),
    turn,

    // The page needs to know whether the Sign button can work at all, so it can
    // say so up front rather than letting somebody type their name and then fail.
    can_sign: Boolean(
      signer && (contract.status === "sent" || contract.status === "viewed") &&
      canSign(signer, signers, contract.signing_order).ok),
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
export async function viewForSigning(db, { contractId, signerId = null, at = new Date() } = {}) {
  const contract = await loadForClient(db, contractId);
  if (!contract) throw notFound();
  if (contract.status === "draft") throw notFound();
  if (contract.status === "void") {
    throw conflict(
      "This document has been withdrawn and can no longer be signed. " +
      "Please contact the person who sent it to you.",
      "voided");
  }

  const { signer, signers, reason } = await resolveSigner(db, { contractId, signerId });
  if (reason === "unknown_signer") throw notFound();
  if (reason === "signer_required") {
    // A multi-signer contract opened with the contract-wide link. Guessing which
    // person this is would let one party sign as another.
    throw conflict(
      "This link does not say who you are. Please use the link that was sent to you personally.",
      "signer_required");
  }

  const integrity = await verifyIntegrity(db, contract);
  const turnVerdict = signer ? canSign(signer, signers, contract.signing_order) : { ok: false };

  /* NOT YOUR TURN IS A REFUSAL, NOT A HIDDEN BUTTON. Under a sequential
     contract the document is not shown at all until everybody ahead has signed.
     Anything less would mean forwarding the second signer's link is enough to
     read a document before the first party has agreed to it. It answers with
     WHO is being waited on, because "not yet" without a name tells somebody
     nothing about what to do. */
  if (signer && !turnVerdict.ok && turnVerdict.reason === "not_your_turn") {
    throw conflict(
      `This document is waiting for ${turnVerdict.waitingOn} to sign first. ` +
      "You will be able to open it after that — the same link will work.",
      "not_your_turn");
  }

  const fresh = (await db.query(
    `UPDATE contracts
        SET view_count = view_count + 1,
            viewed_at  = COALESCE(viewed_at, $2),
            status     = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
            updated_at = now()
      WHERE id = $1::uuid
      RETURNING ${CONTRACT_COLUMNS}`, [contract.id, at])).rows[0] || contract;

  const freshSigner = signer ? await markSignerViewed(db, signer.id, at) : null;
  const freshSigners = await listSigners(db, contract.id);

  return {
    contract: shapeForClient(fresh, {
      integrity, signer: freshSigner, signers: freshSigners,
      turn: waitingSummary(freshSigners, fresh.signing_order)
    }),
    integrity,
    signer: freshSigner
  };
}

/**
 * documentBytes — the file a PDF contract's signing page renders.
 *
 * Serves the SOURCE PDF while signing is in progress and the FINISHED one once
 * everybody has signed, so the same link keeps working and quietly upgrades to
 * the completed document. Text contracts get a generated PDF of their words, so
 * "download a copy" means the same thing for both kinds.
 *
 * Returns null rather than throwing when there is nothing to serve: the caller
 * is an HTTP route that answers 404, and a missing file must not be a 500.
 */
export async function documentBytes(db, contract, { store = null, signed = null } = {}) {
  if (!contract) return null;
  const wantSigned = signed === null ? contract.status === "signed" : signed === true;
  const documentStore = store || storeFromEnv();

  const fetchDoc = async (documentId, versionId) => {
    if (!documentId) return null;
    const target = await resolveStorageTarget(db, { documentId, versionId: versionId || null });
    if (!target || !target.storage_key) return null;
    const got = await documentStore.get(target.storage_key, {
      expectedChecksum: target.checksum || null
    });
    return got ? got.body : null;
  };

  if (wantSigned && contract.signed_document_id) {
    const bytes = await fetchDoc(contract.signed_document_id, contract.signed_document_version_id);
    if (bytes) return { bytes, filename: `${contract.template_key}-signed.pdf`, signed: true };
  }
  if ((contract.source_kind || "text") === "pdf") {
    const bytes = await fetchDoc(contract.source_document_id, contract.source_document_version_id);
    if (bytes) return { bytes, filename: `${contract.template_key}.pdf`, signed: false };
    return null;
  }
  if (!contract.rendered_body) return null;
  return {
    bytes: await textToPdf(contract.rendered_body, { title: contract.title }),
    filename: `${contract.template_key}.pdf`,
    signed: false
  };
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
  contractId, signerId = null, signerName, agreed, fieldValues = {},
  ip = null, userAgent = null, at = new Date(), store = null
} = {}) {
  const contract = await loadForClient(db, contractId);
  if (!contract) throw notFound();

  if (contract.status === "draft") throw notFound();
  if (contract.status === "void") {
    throw conflict("This document has been withdrawn and can no longer be signed.", "voided");
  }
  if (contract.status === "signed") {
    throw conflict("This document has already been signed.", "already_signed");
  }

  // ── 1. WHO is signing ─────────────────────────────────────────────────────
  const { signer, signers, reason } = await resolveSigner(db, { contractId, signerId });
  if (reason === "unknown_signer") throw notFound();
  if (reason === "signer_required" || !signer) {
    throw conflict(
      "This link does not say who you are. Please use the link that was sent to you personally.",
      "signer_required");
  }
  if (signer.status === "signed") {
    throw conflict("You have already signed this document.", "already_signed");
  }
  if (signer.status === "declined") {
    throw conflict("This document was declined and can no longer be signed.", "declined");
  }

  // ── 2. is it their TURN ───────────────────────────────────────────────────
  const turn = canSign(signer, signers, contract.signing_order);
  if (!turn.ok) {
    throw conflict(
      turn.reason === "not_your_turn"
        ? `This document is waiting for ${turn.waitingOn} to sign first.`
        : "This document cannot be signed right now.",
      turn.reason === "not_your_turn" ? "not_your_turn" : "cannot_sign");
  }

  // ── 3. the name and the box ───────────────────────────────────────────────
  const name = String(signerName ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw badRequest("Please type your full name to sign.", "name_required");
  if (name.length > 200) {
    throw badRequest("That name is too long — please type the name you go by.", "name_too_long");
  }
  if (agreed !== true) {
    throw badRequest("Please tick the box to say you agree before signing.", "agreement_required");
  }

  // ── 4. their own boxes ────────────────────────────────────────────────────
  const frozen = contract.fields || [];
  const missing = missingForSigner(frozen, signer.signer_index, fieldValues);
  if (missing.length) {
    throw badRequest(
      `Please fill in: ${missing.join(", ")}.`, "missing_fields", missing);
  }
  /* Only boxes that are BOTH theirs AND fillable survive this. A payload naming
     somebody else's field, or an auto-filled one, is dropped silently — telling
     a client which ids exist would only help them try again. */
  const mine = mergeSignerValues(frozen, signer.signer_index, fieldValues);
  const ownValues = {};
  for (const f of openFieldsForSigner(mine, signer.signer_index)) ownValues[f.id] = f.value;
  // The typed name IS the signature, so it fills every signature box they own.
  for (const f of fieldsForSigner(frozen, signer.signer_index)) {
    if (f.type === "signature") ownValues[f.id] = name;
    if (f.type === "initials") {
      ownValues[f.id] = name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 5);
    }
  }

  // ── 5. THE TAMPER CHECK ───────────────────────────────────────────────────
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

  // ── 6. record THEIR signature ─────────────────────────────────────────────
  // Conditional on signed_at still being NULL: two tabs racing must produce one
  // signature, and the loser must be told rather than overwrite the winner.
  const signedRow = (await db.query(
    `UPDATE contract_signers
        SET status = 'signed', signed_at = $2, signer_name = $3,
            signer_ip = $4, signer_user_agent = $5, field_values = $6::jsonb,
            updated_at = now()
      WHERE id = $1::uuid AND signed_at IS NULL
      RETURNING ${SIGNER_COLUMNS}`,
    [signer.id, at, name,
     ip == null ? null : String(ip).slice(0, 100),
     userAgent == null ? null : String(userAgent).slice(0, 500),
     JSON.stringify(ownValues)])).rows[0];
  if (!signedRow) throw conflict("You have already signed this document.", "already_signed");

  const after = await listSigners(db, contract.id);

  // ── 7. everybody done? ────────────────────────────────────────────────────
  if (!allSigned(after)) {
    const fresh = await loadForClient(db, contract.id);
    return {
      contract: shapeForClient(fresh, {
        integrity, signer: signedRow, signers: after,
        turn: waitingSummary(after, fresh.signing_order)
      }),
      record: fresh,
      signer: signedRow,
      complete: false
    };
  }

  return completeContract(db, {
    contract, signers: after, signer: signedRow, integrity, at, store
  });
}

/**
 * completeContract — the last signature has landed.
 *
 * Produces the finished file, records the completion on the contract, mirrors
 * onto the document registry and emits contract.signed. Runs exactly once: the
 * UPDATE is conditional on signed_at still being NULL, so two signers finishing
 * in the same instant cannot both produce a final document.
 */
async function completeContract(db, { contract, signers, signer, integrity, at, store }) {
  const last = signers.reduce((a, b) =>
    new Date(b.signed_at || 0) > new Date(a.signed_at || 0) ? b : a, signers[0]);

  /* THE FINISHED DOCUMENT. Composed from the FROZEN contract fields with each
     signer's FROZEN entries laid over the top — never from anything still
     writable. Both halves are immutable by database trigger by the time this
     runs, so the file cannot be built from anything that was altered after the
     fact. */
  const composed = (contract.fields || []).map((f) => {
    const owner = signers.find((s) => s.signer_index === Number(f.signer));
    const entered = owner && owner.field_values ? owner.field_values[f.id] : undefined;
    return entered === undefined ? { ...f } : { ...f, value: entered };
  });

  let finished = null;
  try {
    const documentStore = store || storeFromEnv();
    const sourceBytes = (contract.source_kind || "text") === "pdf"
      ? (await documentBytes(db, contract, { store: documentStore, signed: false }))?.bytes
      : await textToPdf(contract.rendered_body || "", { title: contract.title });

    if (sourceBytes) {
      const bytes = (contract.source_kind || "text") === "pdf"
        ? await flatten(sourceBytes, {
            fields: composed, signers,
            contract: { id: contract.id, title: contract.title, body_sha: contract.body_sha }
          })
        // A text contract has no boxes to burn in, so the finished file is the
        // words plus the same signature record page a PDF one gets. Both kinds
        // end up with a downloadable, self-describing signed document.
        : await flatten(sourceBytes, {
            fields: [], signers,
            contract: { id: contract.id, title: contract.title, body_sha: contract.body_sha }
          });

      finished = await storeAndRegister(db, documentStore, {
        orgId: contract.org_id,
        clientId: contract.client_id,
        kind: contract.kind,
        subtype: contract.subtype,
        title: `${contract.title} (signed)`,
        body: bytes,
        mimeType: PDF_MIME,
        filename: `${contract.template_key}-signed.pdf`,
        documentKey: buildDocumentKey({
          kind: contract.kind, subtype: contract.subtype,
          clientId: contract.client_id, discriminator: `${contract.id}:signed`
        }),
        generatedBy: "contracts",
        signatureRequired: false,
        sourceEventId: `contract.signed:${contract.id}`,
        reason: "initial",
        metadata: { contract_id: contract.id, role: "signed" }
      });
    }
  } catch (err) {
    /* THE SIGNATURE IS NOT LOST IF THE FILE CANNOT BE BUILT. Every signature is
       already committed to contract_signers by the time this runs, and those
       rows are the legal record. A failed render is a missing convenience copy,
       and reporting the signature as failed because a PDF would not draw would
       be the worse of the two wrong answers. It is logged loudly and the
       contract still completes. */
    console.warn(`[contracts] could not build the signed document for ${contract.id}: ${err.message}`);
  }

  const rows = (await db.query(
    `UPDATE contracts
        SET status = 'signed', signed_at = $2, signer_name = $3,
            signer_ip = $4, signer_user_agent = $5, completed_at = $2,
            signed_document_id = $6, signed_document_version_id = $7, signed_body_sha = $8,
            updated_at = now()
      WHERE id = $1::uuid AND signed_at IS NULL
      RETURNING ${CONTRACT_COLUMNS}`,
    [contract.id, at, last.signer_name || last.name,
     last.signer_ip, last.signer_user_agent,
     finished?.document?.id || null, finished?.version?.id || null,
     finished?.version?.checksum || null])).rows;

  // Lost the race — somebody else's statement completed it. Report what is there.
  const done = rows[0] || (await loadForClient(db, contract.id));

  if (done.document_id) {
    await markSigned(db, {
      documentId: done.document_id,
      versionId: done.document_version_id || null,
      signerName: last.signer_name || last.name,
      signedAt: at
    }).catch((err) => {
      console.warn(`[contracts] could not mirror the signature onto documents: ${err.message}`);
    });
  }

  if (rows[0]) await emitContractEvent(db, "contract.signed", done);

  return {
    contract: shapeForClient(done, { integrity, signer, signers, turn: null }),
    record: done,
    signer,
    complete: true
  };
}

/**
 * signedCopyHash — the number a person can be given to prove their copy is the
 * one on file. Exposed so the CRM and the signing page can both print it.
 */
export const signedCopyHash = (contract) =>
  contract && contract.rendered_body
    ? createHash("sha256").update(Buffer.from(contract.rendered_body, "utf8")).digest("hex").slice(0, 16)
    : null;
