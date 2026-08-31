// @ts-check
// src/contracts/partner-license.mjs — the one door between a signed partner
// license and 042's payout gate.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): stamping partners.agreement_signed_at
// is what makes a partner payable.
//
// WHAT THIS EXISTS TO PREVENT.
//
// 042_partners.sql refuses to move a partner_payouts run to 'processing' or
// 'paid' while partners.agreement_signed_at is NULL. That is a strong gate and
// it is enforced in the database, where nothing in src/ can talk it out of the
// answer. But the column is a plain timestamptz: ANY `UPDATE partners SET
// agreement_signed_at = now()` opens the gate, whether or not a document exists,
// whether or not anybody signed it, and whether or not the words that were
// signed were the partner license at all.
//
// Until 283_partner_license_template.sql there was no partner license anywhere
// in db/ — the gate held out for a document the platform could not produce. The
// obvious way to unblock a partner in that state is to stamp the column by hand,
// and that turns a real control into a formality with no trace of who decided
// what. So the stamp gets exactly one supported path, and it is this file:
//
//     a signed PARTNER-LICENSE contract, carrying this partner's id in the
//     merge values that were frozen at send, is the ONLY thing that stamps
//     partners.agreement_signed_at.
//
// No document, no stamp, and the refusal says which of the two links is missing
// rather than a single unhelpful "not allowed".
//
// WHY THE LINK IS `merge_values->>'partner_id'` AND NOT A COLUMN. contracts has
// client_id (NOT NULL) and no partner_id, and adding one is a schema change to a
// live table for a link that already has a home: merge_values is jsonb the
// sender fills, and 124's trg_contracts_frozen RAISEs on any change to it once
// status <> 'draft'. So the partner id recorded at send is as immutable as the
// words are, which is the whole property the link needs. A contracts.partner_id
// column would be cleaner and is written down as a gap rather than built here
// (CLAUDE.md §8: no drive-by schema work).
//
// THE STAMP IS WRITE-ONCE. A partner who already has a date keeps it. Restating
// when somebody signed, because the row was re-processed, would move the moment
// their money became payable — the same reason partner_revenue freezes
// share_pct_applied instead of reading the live rate.

import { badRequest, notFound, conflict } from "./errors.mjs";

/** The template_key seeded by db/migrations/283_partner_license_template.sql.
 *  Never renamed — 124 records why a template key is permanent. */
export const PARTNER_LICENSE_TEMPLATE_KEY = "PARTNER-LICENSE";

/** documents.subtype / contract_templates.subtype, from src/documents/kinds.mjs.
 *  030_documents.sql names this as the thing the payout holds are named after. */
export const PARTNER_LICENSE_SUBTYPE = "partner_license";

/** The merge-values key carrying which partner a license belongs to. Frozen at
 *  send with the rest of merge_values. */
export const PARTNER_ID_MERGE_KEY = "partner_id";

/** The partner's half. Owner-set, docs/specs/W0-decisions.md 2026-08-31: "The
 *  50% never moves." Matches partners.revenue_share_pct's schema default in
 *  042_partners.sql, and src/contracts/partner-license-terms.test.mjs fails if
 *  the two ever disagree or if the seeded words stop saying it. */
export const PARTNER_SHARE_PCT = 50;

/** The refund window on the $10,000 joining fee, in days. W0: "keep it a short
 *  refund period", recorded as 3 days pending the exact figure. Recorded here
 *  because the seeded words state it and something in code has to be able to
 *  check that they still do. */
export const PARTNER_ENTRY_REFUND_DAYS = 3;

/**
 * The partner license copy for an org, or null when it has not been seeded.
 *
 * Null is a real answer and callers must handle it: an org created before 283
 * ran, or one that archived the row, genuinely has no license to send.
 *
 * @param {{query: (text: string, params?: any[]) => Promise<{rows: any[]}>}} db
 * @param {{orgId?: string|null, activeOnly?: boolean}} [args]
 * @returns {Promise<any|null>}
 */
export async function getPartnerLicenseTemplate(db, { orgId, activeOnly = true } = {}) {
  if (!orgId) throw badRequest("A partner license lookup needs to know which company it is for.", "org_required");
  const { rows } = await db.query(
    `SELECT id, org_id, template_key, name, kind, subtype, body, manual_fields,
            signature_required, signature_statement, active, source_kind
       FROM contract_templates
      WHERE org_id = $1::uuid AND template_key = $2
        AND ($3::boolean IS NOT TRUE OR active)
      LIMIT 1`,
    [orgId, PARTNER_LICENSE_TEMPLATE_KEY, activeOnly]
  );
  return rows[0] || null;
}

/**
 * The signed partner license for one partner, or null.
 *
 * Matched on three things at once, because any two of them can be true of a
 * document that is not this partner's license:
 *   * template_key — the words that were signed were the license
 *   * status/signed_at — somebody actually signed it, not just received it
 *   * merge_values.partner_id — it was this partner, frozen at send
 *
 * Demo contracts are excluded. 148_demo_mode.sql exists because on 2026-08-27
 * all 44 contracts in production were test artifacts showing to the operator as
 * real signed agreements; a demo license must never make anybody payable.
 *
 * The oldest signature wins when there is more than one: re-signing is not a
 * reason for money to have become payable later than it did.
 *
 * @param {{query: (text: string, params?: any[]) => Promise<{rows: any[]}>}} db
 * @param {{orgId?: string|null, partnerId?: string|null}} [args]
 * @returns {Promise<any|null>}
 */
export async function findSignedPartnerLicense(db, { orgId, partnerId } = {}) {
  if (!orgId) throw badRequest("A partner license lookup needs to know which company it is for.", "org_required");
  if (!partnerId) throw badRequest("A partner license lookup needs to know which partner it is for.", "partner_required");
  const { rows } = await db.query(
    `SELECT id, org_id, client_id, template_key, title, status, signed_at,
            signer_name, body_sha, merge_values, document_id, is_demo
       FROM contracts
      WHERE org_id = $1::uuid
        AND template_key = $2
        AND status = 'signed'
        AND signed_at IS NOT NULL
        AND is_demo = false
        AND merge_values->>$3 = $4::text
      ORDER BY signed_at ASC
      LIMIT 1`,
    [orgId, PARTNER_LICENSE_TEMPLATE_KEY, PARTNER_ID_MERGE_KEY, partnerId]
  );
  return rows[0] || null;
}

/**
 * Stamp partners.agreement_signed_at from a real signed license, and refuse
 * every other way of stamping it.
 *
 * Order of refusals is deliberate — the answer names which link is missing:
 *   1. the partner is not on file            → 404 partner_not_found
 *   2. no PARTNER-LICENSE copy exists at all → 409 partner_license_template_missing
 *   3. no signed license for this partner    → 409 partner_license_not_signed
 *
 * (2) is separated from (3) because they need different people: the first is an
 * unseeded org and the second is a partner who has not been sent the document.
 *
 * Already stamped is not an error. The existing date is returned unchanged, with
 * `stamped: false`, so a re-run of an onboarding step is safe and cannot move the
 * moment a partner became payable.
 *
 * @param {{query: (text: string, params?: any[]) => Promise<{rows: any[]}>}} db
 * @param {{orgId?: string|null, partnerId?: string|null}} [args]
 * @returns {Promise<{partnerId: string, agreementSignedAt: Date|string,
 *                    contractId: string|null, stamped: boolean}>}
 */
export async function stampPartnerAgreement(db, { orgId, partnerId } = {}) {
  if (!orgId) throw badRequest("Stamping a partner agreement needs to know which company it is for.", "org_required");
  if (!partnerId) throw badRequest("Stamping a partner agreement needs to know which partner it is for.", "partner_required");

  const existing = await db.query(
    `SELECT id, agreement_signed_at FROM partners
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [partnerId, orgId]
  );
  const partner = existing.rows[0];
  if (!partner) throw notFound("That partner is not on file.", "partner_not_found");

  const signed = await findSignedPartnerLicense(db, { orgId, partnerId });

  if (partner.agreement_signed_at) {
    /* Write-once. Reported honestly rather than silently: the caller learns the
       partner was already payable and, when a license exists, which document
       said so. */
    return {
      partnerId,
      agreementSignedAt: partner.agreement_signed_at,
      contractId: signed ? signed.id : null,
      stamped: false
    };
  }

  if (!signed) {
    const template = await getPartnerLicenseTemplate(db, { orgId, activeOnly: false });
    if (!template) {
      throw conflict(
        "There is no partner license wording set up for this company yet, so nobody can " +
        "sign one and no partner can be paid. Add it on the Contracts screen.",
        "partner_license_template_missing");
    }
    throw conflict(
      "This partner has not signed their partner license yet. Send it to them from the " +
      "Contracts screen — payouts stay held until it is signed.",
      "partner_license_not_signed");
  }

  const { rows } = await db.query(
    /* The WHERE clause repeats `agreement_signed_at IS NULL` so two callers
       racing cannot both write: the loser updates nothing and reads the winner's
       date below. Checking in JavaScript and writing unconditionally would let
       the second write move the date. */
    `UPDATE partners
        SET agreement_signed_at = $3::timestamptz, updated_at = now()
      WHERE id = $1::uuid AND org_id = $2::uuid AND agreement_signed_at IS NULL
      RETURNING id, agreement_signed_at`,
    [partnerId, orgId, signed.signed_at]
  );

  if (!rows[0]) {
    const reread = await db.query(
      `SELECT agreement_signed_at FROM partners WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [partnerId, orgId]);
    return {
      partnerId,
      agreementSignedAt: reread.rows[0] ? reread.rows[0].agreement_signed_at : signed.signed_at,
      contractId: signed.id,
      stamped: false
    };
  }

  return {
    partnerId,
    agreementSignedAt: rows[0].agreement_signed_at,
    contractId: signed.id,
    stamped: true
  };
}
