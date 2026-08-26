// Gate: does this client currently authorize Fundhub to PREPARE dispute
// letters and complaint drafts?
//
// Wraps hasValidConsent for kind `dispute_authorization`. Fail-closed: a
// missing org, client, or row is false. Does not mail or file anything.
// Dated/live complaint packs must pass this. DIY undated templates may still
// generate with a "sign the declaration before filing" cover.
//
// Generate and Stage may write letters only when a signed repair agreement
// is on file. Staff consent or enroll alone is not that paper.

import { hasValidConsent } from "../consent/index.mjs";

const SIGNED_REPAIR_SQL = `
  SELECT 1
    FROM contracts c
    LEFT JOIN contract_templates t
      ON t.org_id = c.org_id AND t.template_key = c.template_key
   WHERE c.org_id = $1::uuid
     AND c.client_id = $2::uuid
     AND c.status = 'signed'
     AND (
       t.subtype = 'credit_repair'
       OR c.template_key ILIKE '%REPAIR%'
     )
   LIMIT 1`;

export async function hasDisputeAuthorization(db, { orgId, clientId } = {}) {
  return hasValidConsent(db, { orgId, clientId, kind: "dispute_authorization" });
}

/** True only when a signed repair agreement is on file. Fail-closed. */
export async function hasRepairAgreement(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return false;
  try {
    const signed = await db.query(SIGNED_REPAIR_SQL, [orgId, clientId]);
    return Boolean(signed.rows[0]);
  } catch {
    return false;
  }
}
