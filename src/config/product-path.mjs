// Rule 4 — route by outcome tier NAME, never by dollar amount.
// REAL CRS ladder (verified against the live engine, underwrite-iq-lite route-outcome.js:15-20):
//   FRAUD_HOLD → MANUAL_REVIEW → REPAIR_ONLY → FUNDING_PLUS_REPAIR → FULL_FUNDING → PREMIUM_STACK
// Funding path = the three funding tiers. Anything else (including unrecognized / null) is NOT
// a funding path — fail closed. (Chris-confirmed 2026-07-27: pull the real strings, don't guess.)
const FUNDING_TIERS = ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"];
const REPAIR_TIERS = ["REPAIR_ONLY"];

export function isFundingPath(tier) {
  if (!tier) return false;
  return FUNDING_TIERS.includes(String(tier));
}

export function isRepairOnlyPath(tier) {
  if (!tier) return false;
  return REPAIR_TIERS.includes(String(tier));
}

export async function clientOutcomeTier(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [clientId]);
  return r.rows[0]?.outcome_tier ?? null;
}
