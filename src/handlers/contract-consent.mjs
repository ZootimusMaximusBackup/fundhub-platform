// contract.signed → a soft-pull consent record.
//
// COMPLIANCE REVIEW REQUIRED: consent capture. This handler writes rows to
// `client_consents`, which is the table the credit-pull gate reads
// (src/finance/soft-pulls.mjs:306). CLAUDE.md §7 flags anything on this path.
//
// ═══════════════════════════════════════════════════════════════════════════
// OWNER-SET, 2026-08-19 — Chris. A signed SOFT-PULL-CONSENT contract counts as
// soft-pull consent, and this handler is what makes that true.
//
// This REVERSES an earlier engineering decision, recorded in
// src/handlers/contract-signed.mjs:41-48, which deliberately wrote no consent
// row and reasoned it as: "Two writers for one permission is how a revocation
// stops biting." That reasoning was sound and it is not dismissed here — it is
// the specification for this file. Every guard below exists to make the named
// failure impossible rather than merely unlikely:
//
//   * A REVOCATION KEEPS BITING. See THE WITHDRAWAL RULE below.
//   * ONE PAPER, ONE ROW. See IDEMPOTENCY below.
//   * NOTHING ELSE IS A CONSENT. See WHAT COUNTS AS THE INSTRUMENT below.
//
// contract-signed.mjs is left exactly as it was. Its job is the countersigned
// copy and the task; this is a second, separately registered listener on the
// same event, so a failure in either one cannot suppress the other — the bus
// runs each handler in isolation (src/events/bus.mjs:112-120).
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT COUNTS AS THE INSTRUMENT
//
// The gate is the (kind, subtype) pair, NOT the template key:
//
//     kind = 'authorization'  AND  subtype = 'soft_pull_consent'
//
// Those are the values db/seed/007_contract_templates.sql:62-64 gives the
// SOFT-PULL-CONSENT template, and 'soft_pull_consent' is the authorization
// subtype src/documents/kinds.mjs:24 already names for this exact purpose.
// src/contracts/send.mjs:167 copies both from the template onto every contract,
// so the pair travels with the signed record.
//
// TEMPLATE KEY IS NOT THE GATE, on purpose. `contracts.template_key` is a
// snapshot label (124_contracts.sql:145) and src/contracts/templates.mjs lets
// an org create a template with any key it likes. Gating on the string
// 'SOFT-PULL-CONSENT' would mean a contract that merely borrowed the name could
// unlock a credit pull, and a correctly classified authorization with a
// different key could not. The classification is the fact; the key is a label.
//
// The consequence, stated plainly: an authorization whose subtype was left
// blank writes no consent row and the pull gate stays shut. That is the safe
// direction of being wrong, and it is visible — the pull is refused, loudly.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE WITHDRAWAL RULE
//
//   A signature can only grant permission that did not already exist when it
//   was signed. If the consumer withdrew this permission AFTER the moment they
//   signed, the withdrawal is the later fact and it wins — forever.
//
// Implemented as: refuse if any `soft_pull_consent` row for this client in this
// org carries revoked_at >= the contract's signed_at. That covers the case the
// document-level dedupe below cannot, which is a consent captured somewhere
// else (a phone call through /api/consent/capture, with no document_id), later
// revoked, and then a stale contract.signed replayed on top of it.
//
// It does NOT block a genuine re-consent: signing a NEW soft-pull authorization
// after a withdrawal is a new contract, with a new signed_at that is later than
// the revocation, and it grants normally.
//
// Both halves are evaluated IN THE SQL, against the database's clock, for the
// reason src/consent/index.mjs states in its header: comparing a Postgres
// timestamp to `new Date()` puts two clocks in a compliance decision.
//
// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY (Rule 9), AND WHY IT CANNOT LEAN ON THE BUS
//
// src/events/bus.mjs replay() re-dispatches stored events WITHOUT re-checking
// the idempotency key (bus.mjs:71-88 reads the rows and calls dispatch on each
// one), and captureConsent() is explicitly NOT deduplicated — see its own
// docstring, and 099's header on why there is no unique index on this table. So
// a naive handler writes a fresh consent row on every replay.
//
// The key here is the SIGNED DOCUMENT: one signed paper produces at most one
// consent row. `client_consents.document_id` already points at that paper, so
// the check is a read of the column the row was going to be written with — no
// new column, no new index, nothing to keep in step.
//
// A row already pointing at this document is a stop whether it is live or
// revoked, which is what makes the withdrawal rule hold on the ordinary replay
// path as well as the awkward one.
//
// NOT SAFE AGAINST TWO SIMULTANEOUS DISPATCHES of the same event, and said out
// loud rather than implied: the check and the insert are two statements with no
// lock between them. Replay is sequential and emit() dedupes on the idempotency
// key, so there is no path in this repository that produces the race today. If
// one is ever added, the fix is a unique partial index on
// (org_id, client_id, kind, document_id), not a lock here.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE WORDS ARE THE SERVER'S, NOT THE CONTRACT'S
//
// consent_text comes from disclosureFor('soft_pull_consent') and never from
// contracts.rendered_body. That rule is stated at length in
// src/consent/disclosures.mjs and restated in api/consent/capture.mjs; this
// handler is a third writer on that table and obeys the same rule. The column
// list below deliberately omits rendered_body so the words of the signed
// agreement are not even in scope here.
//
// KNOWN GAP, recorded rather than smoothed over: the consumer read the CONTRACT
// body, and the row stores the approved server disclosure `soft-pull-v1`. The
// two are not the same paragraph. The disclosure is the narrower of the pair —
// it claims nothing the contract does not — and document_id points at the exact
// paper they did sign, so the evidence trail is complete. Reconciling the two
// wordings is a compliance decision, not an engineering one.
//
// ═══════════════════════════════════════════════════════════════════════════
// ERRORS ARE NOT SWALLOWED. Every input captureConsent() validates is checked
// here first and refused with a reason, so anything that still throws is a real
// database failure. Letting it reach the bus records it on the dead-letter
// queue and keeps it retryable; absorbing it would lose the work quietly.

import { on } from "../events/registry.mjs";
import { captureConsent } from "../consent/index.mjs";
import { disclosureFor } from "../consent/disclosures.mjs";

/** The one consent kind a signature can produce. */
export const CONSENT_KIND = "soft_pull_consent";

/** The (kind, subtype) pair that makes a contract the soft-pull instrument. */
export const INSTRUMENT_KIND = "authorization";
export const INSTRUMENT_SUBTYPE = CONSENT_KIND;

/* Only what this handler needs, and rendered_body is deliberately absent —
   same list discipline as SIGNED_COLUMNS in contract-signed.mjs:96-98, and here
   it is load-bearing: the consent text must come from the server disclosure,
   so the contract's words have no business being readable in this file. */
const CONSENT_CONTRACT_COLUMNS = `
  id, org_id, client_id, template_key, title, kind, subtype, status,
  merge_values, sent_by, signed_at, signer_name, signed_document_id`;

/**
 * loadSoftPullContract — the row behind the event, org-scoped.
 *
 * Same shape and same reason as loadSignedContract() in
 * contract-signed.mjs:120-131: the contract.signed payload carries neither the
 * signer's name nor the signed document's id, so the row has to be read, and an
 * event naming another company's contract must find nothing.
 *
 * Not reusing that function only because it selects a narrower column list —
 * this one needs kind, subtype and merge_values, and that file belongs to a
 * decision that is deliberately being left untouched.
 */
export async function loadSoftPullContract(db, { orgId, contractId } = {}) {
  if (!orgId || !contractId) return null;
  const { rows } = await db.query(
    `SELECT ${CONSENT_CONTRACT_COLUMNS} FROM contracts
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [contractId, orgId]
  );
  return rows[0] || null;
}

/** isSoftPullInstrument — is this signature actually a soft-pull authorization?
 *  See WHAT COUNTS AS THE INSTRUMENT above for why the template key is not
 *  consulted. Case and padding are normalised; nothing else is accepted. */
export function isSoftPullInstrument(contract) {
  if (!contract) return false;
  const kind = String(contract.kind ?? "").trim().toLowerCase();
  const subtype = String(contract.subtype ?? "").trim().toLowerCase();
  return kind === INSTRUMENT_KIND && subtype === INSTRUMENT_SUBTYPE;
}

/**
 * consentTerm — how long the paper says the permission lasts.
 *
 * THREE ANSWERS, NOT TWO, and the third is the point:
 *
 *   { state: "absent"     } the instrument names no term at all. The consent
 *                           does not expire, because nothing said it would.
 *   { state: "days", days } a whole number of days from the signature.
 *   { state: "unreadable" } the instrument NAMES a term and we cannot compute
 *                           it. Refuse — see below.
 *
 * The seeded soft-pull authorization says "This permission lasts
 * {{field.consent_days}} days from the date above unless I withdraw it sooner"
 * (db/seed/007_contract_templates.sql:75) and makes consent_days a REQUIRED
 * manual field (007:84), which src/contracts/send.mjs:316-321 refuses to send
 * without. src/config/offers.mjs:130 fills it with "90" on the offer path.
 *
 * WHY AN UNREADABLE TERM IS A REFUSAL AND NOT A NULL. NULL in expires_at means
 * "does not expire" (099's header). Writing NULL because we could not parse
 * "ninety" would silently grant a PERMANENT permission off a paper that granted
 * a temporary one — the single most expensive direction to be wrong in on this
 * table. An absent field is different: there is no term to lose.
 */
export function consentTerm(mergeValues) {
  const raw = mergeValues && typeof mergeValues === "object"
    ? mergeValues.consent_days
    : undefined;
  if (raw === undefined || raw === null) return { state: "absent", days: null };

  /* SHAPE BEFORE VALUE, and this line is not defensive padding — it is a real
     hole that the test for it found. merge_values is jsonb, so this field can
     hold anything, and `String([])` is the EMPTY STRING. Stringifying first
     would read an array as "no term at all" and write a permanent permission
     off a paper that granted a temporary one, which is the exact substitution
     this three-state answer exists to prevent. Only text or a number is a term. */
  if (typeof raw !== "string" && typeof raw !== "number") {
    return { state: "unreadable", days: null };
  }

  const text = String(raw).trim();
  if (text === "") return { state: "absent", days: null };

  /* Digits only, rather than Number() alone. Number() reads "0x5A" as 90 and
     "1e3" as 1000, and neither is something a person typed into a box labelled
     "Permission lasts (days)". A value we have to be clever to read is one we
     should refuse. */
  if (!/^\d+$/.test(text)) return { state: "unreadable", days: null };
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n <= 0) return { state: "unreadable", days: null };
  return { state: "days", days: n };
}

/* expiryFrom — signature + N days, as an absolute instant.
   Days are 24 hours here, not calendar days. timestamptz is an absolute point
   in time and the paper says "days from the date above"; a calendar-aware
   version would need a timezone the contract never captured. */
function expiryFrom(signedAt, days) {
  const base = signedAt instanceof Date ? signedAt : new Date(signedAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + days * 86_400_000);
}

/**
 * consentGuard — the two refusals, in ONE statement, on the database's clock.
 *
 * `from_this_document` — has this exact signed paper already produced a consent
 * row? Any state counts, revoked included. This is the replay stop.
 *
 * `withdrawn_since` — did the consumer take this permission back at or after
 * the moment they signed? This is the withdrawal stop, and it is the one that
 * catches a revocation of a consent captured somewhere else entirely.
 *
 * One scan of this client's consent history for this kind, served by
 * idx_client_consents_lookup (099). Counts come back from Postgres as strings
 * because they are bigint, so they are converted here rather than compared
 * loosely somewhere later.
 */
export async function consentGuard(db, { orgId, clientId, documentId, signedAt } = {}) {
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE document_id = $4::uuid) AS from_this_document,
       count(*) FILTER (WHERE revoked_at IS NOT NULL
                          AND revoked_at >= $5::timestamptz) AS withdrawn_since
       FROM client_consents
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND kind = $3`,
    [orgId, clientId, CONSENT_KIND, documentId, signedAt]
  );
  const row = rows[0] || {};
  return {
    fromThisDocument: Number(row.from_this_document ?? 0),
    withdrawnSince: Number(row.withdrawn_since ?? 0)
  };
}

/**
 * onContractSignedConsent — the handler.
 *
 * Returns { recorded, reason, ... }. `recorded: false` is the normal answer for
 * every contract that is not a soft-pull authorization, and for every replay.
 * It is never an error and never a throw.
 */
export async function onContractSignedConsent(event, db) {
  const orgId = event?.orgId || null;
  const contractId = event?.payload?.contract_id || null;
  if (!orgId || !contractId) return { recorded: false, reason: "no_contract" };

  const contract = await loadSoftPullContract(db, { orgId, contractId });
  if (!contract) return { recorded: false, reason: "contract_not_found" };

  // The gate. Most signatures stop here, and stopping here costs one read.
  if (!isSoftPullInstrument(contract)) {
    return { recorded: false, reason: "not_the_soft_pull_instrument" };
  }

  /* STATUS IS RE-READ, NOT TRUSTED FROM THE EVENT NAME. A contract that has
     since been voided must not grant permission on a replay of the signature
     that preceded the void. 124_contracts.sql:209-210 makes 'void' and 'signed'
     mutually exclusive, so this single comparison is the whole check. */
  if (String(contract.status ?? "").trim() !== "signed") {
    return { recorded: false, reason: "not_signed", status: contract.status ?? null };
  }

  /* contracts.client_id is NOT NULL (124_contracts.sql:137), so this is a
     malformed-row guard rather than an expected path — but a consent row with
     no consumer on it is not one this handler will half-write. */
  const clientId = contract.client_id || null;
  if (!clientId) return { recorded: false, reason: "no_client" };

  /* NO PAPER, NO CONSENT. sign.mjs:478-486 completes a contract even when the
     signed PDF fails to render, leaving signed_document_id NULL. Two things
     break at once in that case: the consent record would point at nothing, and
     the replay guard has no key to dedupe on. Both say the same thing — record
     this one through /api/consent/capture, with a person present. */
  const documentId = contract.signed_document_id || null;
  if (!documentId) return { recorded: false, reason: "no_signed_document" };

  /* captureMethod 'signature' REQUIRES a name — client_consents_method_ck, and
     src/consent/index.mjs refuses it before the database does.
     contracts_signature_pair_ck (124:201-204) makes a signed row carry one, so
     this and the next check are guards against a malformed row, not a branch
     the ordinary path takes. */
  const grantedName = String(contract.signer_name ?? "").trim();
  if (!grantedName) return { recorded: false, reason: "no_signer_name" };

  const signedAt = contract.signed_at ? new Date(contract.signed_at) : null;
  if (!signedAt || Number.isNaN(signedAt.getTime())) {
    return { recorded: false, reason: "no_signed_at" };
  }

  /* WHO IS ACCOUNTABLE FOR THE RECORD. granted_by_kind 'staff' does not mean an
     employee consented for the consumer — 099's header is explicit that nobody
     can — it means an employee is accountable for the accuracy of a consent the
     consumer gave elsewhere. Here that is whoever sent the authorization for
     signature, and granted_name below carries the consumer's own name.

     'client' is not available: the signing link is an HMAC over the contract id
     and the signer is not signed in (src/contracts/sign.mjs:64-71), so there is
     no accounts.id to attribute to, and granted_by_account_id is a real foreign
     key. Guessing one would be inventing a person.

     send.mjs:264 refuses a send with no staff id, so sent_by is populated on
     anything that reached 'signed'. The refusal below is for a row that somehow
     did not, and it is permanent rather than retryable — hence a clean stop
     with a reason rather than a throw onto the dead-letter queue. */
  const sentBy = contract.sent_by || null;
  if (!sentBy) return { recorded: false, reason: "no_attributable_staff" };

  const term = consentTerm(contract.merge_values);
  if (term.state === "unreadable") {
    return { recorded: false, reason: "consent_term_unreadable" };
  }
  const expiresAt = term.state === "days" ? expiryFrom(signedAt, term.days) : null;
  /* A day count so large the arithmetic falls off the end of the Date range
     produces an Invalid Date. normalizeExpiry() would throw on that and the
     event would sit on the dead-letter queue being retried forever, so it is
     refused here as what it is: a term nobody can read. */
  if (term.state === "days" && (!expiresAt || Number.isNaN(expiresAt.getTime()))) {
    return { recorded: false, reason: "consent_term_unreadable" };
  }
  /* A term that has already run out. client_consents_expiry_ck requires
     expires_at > granted_at and granted_at defaults to now(), so writing this
     would be a constraint error rather than a row — and the honest reading is
     that there is nothing left to record: the permission the paper granted has
     expired. Reachable only on a very late dead-letter retry. */
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return { recorded: false, reason: "consent_term_already_expired" };
  }

  const guard = await consentGuard(db, { orgId, clientId, documentId, signedAt });
  if (guard.fromThisDocument > 0) {
    return { recorded: false, reason: "already_recorded", clientId, documentId };
  }
  if (guard.withdrawnSince > 0) {
    return { recorded: false, reason: "withdrawn_after_signature", clientId, documentId };
  }

  /* The words come from the server. A null here would mean the approved
     disclosure for this kind had gone missing, which is a refusal and never a
     fallback to some other paragraph — see src/consent/disclosures.mjs. */
  const disclosure = disclosureFor(CONSENT_KIND);
  if (!disclosure) return { recorded: false, reason: "no_disclosure" };

  const consent = await captureConsent(db, {
    orgId,
    clientId,
    kind: CONSENT_KIND,
    consentText: disclosure.text,
    consentVersion: disclosure.version,
    grantedBy: { kind: "staff", id: sentBy },
    captureMethod: "signature",
    grantedName,
    // The paper. This is also the idempotency key consentGuard() reads.
    documentId,
    expiresAt
    /* capturedIp and capturedUserAgent are NOT set. sign.mjs records the
       signer's ip and user agent on the CONTRACT, and copying them here would
       dress a server-side derivation up as web-capture evidence collected at
       this moment. The signed document is the evidence; the columns stay null,
       which is what "unknown at capture" is supposed to look like. */
  });

  return {
    recorded: true,
    consentId: consent.id,
    clientId,
    contractId: contract.id,
    documentId,
    templateKey: contract.template_key || null,
    consentVersion: disclosure.version,
    expiresAt: consent.expires_at ?? null
  };
}

export function register() {
  on("contract.signed", onContractSignedConsent);
}

export default register;
