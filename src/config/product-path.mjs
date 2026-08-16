// Rule 4 — route by outcome tier NAME, never by dollar amount.
// REAL CRS ladder (verified against the live engine, underwrite-iq-lite route-outcome.js:15-20):
//   FRAUD_HOLD → MANUAL_REVIEW → REPAIR_ONLY → FUNDING_PLUS_REPAIR → FULL_FUNDING → PREMIUM_STACK
//
// Funding path = the three funding tiers only. MANUAL_REVIEW / FRAUD_HOLD / null / "" /
// typos / wrong case / extra spaces are NOT funding — fail closed (exact string match).
// Do not normalize or invent tiers; callers must get an exact CRS string.
// (Chris-confirmed 2026-07-27: pull the real strings, don't guess.)
const FUNDING_TIERS = ["FUNDING_PLUS_REPAIR", "FULL_FUNDING", "PREMIUM_STACK"];
const REPAIR_TIERS = ["REPAIR_ONLY"];

export function isFundingPath(tier) {
  if (tier == null || tier === "") return false;
  return FUNDING_TIERS.includes(String(tier));
}

export function isRepairOnlyPath(tier) {
  if (tier == null || tier === "") return false;
  return REPAIR_TIERS.includes(String(tier));
}

export async function clientOutcomeTier(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [clientId]);
  return r.rows[0]?.outcome_tier ?? null;
}

// resolveOutcomeTier — tier for a workflow that runs DURING the CRS run rather than
// after it. `clients.outcome_tier` is written by exactly one handler
// (client-lifecycle.mjs:onDecisionRendered, on decision.rendered), so a workflow
// triggered by the analysis.completed that immediately precedes it reads null on a
// first pull and a stale tier on a re-pull. The tier it needs is already in hand —
// on its own event payload — so prefer that and fall back to the column.
//
// Use this in any workflow whose trigger is not strictly after decision.rendered.
// Workflows further down the spine (deposit.paid, round.*, mail.response) can keep
// using clientOutcomeTier: by then the column is authoritative.
export async function resolveOutcomeTier(db, clientId, payload) {
  const fromEvent = payload?.outcomeTier;
  if (fromEvent) return String(fromEvent);
  return clientOutcomeTier(db, clientId);
}
