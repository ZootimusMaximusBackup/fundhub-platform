// Rule 4 — route by outcome tier NAME, never by dollar amount.
// Real CRS ladder: FRAUD_HOLD → MANUAL_REVIEW → REPAIR → CONDITIONAL_APPROVAL → FULL_STACK_APPROVAL → PREMIUM_STACK.
// Funding path = the three approval tiers. Anything else (including unrecognized / null) is NOT a funding path.

const FUNDING_TIERS = ["CONDITIONAL_APPROVAL", "FULL_STACK_APPROVAL", "PREMIUM_STACK"];
const REPAIR_TIERS = ["REPAIR"];

export function isFundingPath(tier) {
  if (!tier) return false;
  return FUNDING_TIERS.includes(String(tier));
}

export function isRepairOnlyPath(tier) {
  if (!tier) return false;
  return REPAIR_TIERS.includes(String(tier));
}

export async function clientOutcomeTier(db, clientId) {
  const r = await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [clientId]);
  return r.rows[0]?.outcome_tier ?? null;
}
