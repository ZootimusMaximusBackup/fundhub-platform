// Gate: does this client currently authorize Fundhub to PREPARE dispute
// letters and complaint drafts?
//
// Wraps hasValidConsent for kind `dispute_authorization`. Fail-closed: a
// missing org, client, or row is false. Does not mail or file anything.
// Dated/live complaint packs must pass this. DIY undated templates may still
// generate with a "sign the declaration before filing" cover.
//
// Staging letters also accepts a signed repair contract or an active repair
// program (the person already enrolled). That is the "agreement" the Specialist
// desk means — not only the extra dispute_authorization row.

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

const ACTIVE_PROGRAM_SQL = `
  SELECT 1 FROM repair_programs
   WHERE org_id = $1::uuid AND client_id = $2::uuid
     AND status IS DISTINCT FROM 'cancelled'
   LIMIT 1`;

export async function hasDisputeAuthorization(db, { orgId, clientId } = {}) {
  return hasValidConsent(db, { orgId, clientId, kind: "dispute_authorization" });
}

/** True when we may PREPARE letters: consent, signed repair paper, or enrolled. */
export async function hasRepairAgreement(db, { orgId, clientId } = {}) {
  if (await hasDisputeAuthorization(db, { orgId, clientId })) return true;
  if (!db?.query || !orgId || !clientId) return false;
  try {
    const signed = await db.query(SIGNED_REPAIR_SQL, [orgId, clientId]);
    if (signed.rows[0]) return true;
  } catch {
    /* next source */
  }
  try {
    const program = await db.query(ACTIVE_PROGRAM_SQL, [orgId, clientId]);
    if (program.rows[0]) return true;
  } catch {
    /* fail closed */
  }
  return false;
}
