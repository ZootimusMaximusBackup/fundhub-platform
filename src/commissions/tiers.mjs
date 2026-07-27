// Graduated (tiered) rates.
//
// Brackets are on the AMOUNT BASIS, not on the commission. "Rounds funding over
// $50,000 pay 0.5%" is a bracket of [50000, null) at 0.5%.
//
// Bracket bounds are half open: [min, max). A base landing exactly on a
// boundary falls in the upper bracket, which is the reading a person expects
// from "over $50,000".
//
// Pure.

import { toCents, percentOf, wholeUnits, roundHalfUp } from "./money.mjs";

/** Sort ascending by lower bound. Input order is not trusted. */
export function sortTiers(tiers) {
  return [...tiers].sort((a, b) => toCents(a.min_amount ?? 0) - toCents(b.min_amount ?? 0));
}

/** The single bracket containing `baseCents`, or null if the ladder has a hole. */
export function tierFor(tiers, baseCents) {
  for (const t of sortTiers(tiers)) {
    const lo = toCents(t.min_amount ?? 0);
    const hi = t.max_amount === null || t.max_amount === undefined ? null : toCents(t.max_amount);
    if (baseCents >= lo && (hi === null || baseCents < hi)) return t;
  }
  return null;
}

/** One bracket's payout on a given slice of base. */
function tierAmount(tier, sliceCents) {
  let total = 0;
  if (tier.percent !== null && tier.percent !== undefined) {
    total += percentOf(sliceCents, tier.percent);
  }
  if (tier.per_unit_amount !== null && tier.per_unit_amount !== undefined) {
    const unit = toCents(tier.per_unit_amount);
    total += wholeUnits(sliceCents, unit) * toCents(tier.flat_amount ?? 0);
  } else if (tier.flat_amount !== null && tier.flat_amount !== undefined) {
    total += toCents(tier.flat_amount);
  }
  return roundHalfUp(total);
}

/**
 * Compute a tiered rule.
 *
 *   'marginal' — THE DEFAULT. Each bracket pays its own rate on its own slice,
 *                tax-bracket style. Only the dollars above a bracket pay the
 *                higher rate. Percent only; a flat amount inside a marginal
 *                ladder is ambiguous, so it is rejected rather than guessed at.
 *   'whole'    — the entire base pays at the matching bracket's rate.
 *                $60k against a [50k, null) 0.5% bracket = $300.
 *
 * Marginal is the default (CHRIS PROVISIONAL #6a) because a whole-ladder creates
 * a cliff: funding one dollar more jumps the entire commission to the higher
 * rate. That is expensive, and it is an incentive to game the funded number.
 *
 * Returns integer cents. A base that falls outside every bracket pays 0 — an
 * incomplete ladder does not silently fall back to the nearest rate.
 */
export function computeTiered(tiers, baseCents, mode = "marginal") {
  if (!Array.isArray(tiers) || tiers.length === 0) return 0;
  const sign = baseCents < 0 ? -1 : 1;
  const abs = Math.abs(baseCents);

  if (mode === "whole") {
    const tier = tierFor(tiers, abs);
    return tier ? tierAmount(tier, abs) * sign : 0;
  }

  if (mode === "marginal") {
    let total = 0;
    for (const t of sortTiers(tiers)) {
      if (t.flat_amount !== null && t.flat_amount !== undefined) {
        // Marginal is the default, so a flat-bracket ladder built without
        // thinking about the mode lands here. Say what to do about it.
        throw new Error(
          `computeTiered: marginal tiers must use percent only — tier ${t.id ?? "?"} has a flat_amount. ` +
            `Set the rule's tier_mode to 'whole' for a flat-bracket ladder.`
        );
      }
      const lo = toCents(t.min_amount ?? 0);
      const hi = t.max_amount === null || t.max_amount === undefined ? Infinity : toCents(t.max_amount);
      if (abs <= lo) break;
      const slice = Math.min(abs, hi) - lo;
      if (slice > 0) total += percentOf(slice, t.percent ?? 0);
    }
    return roundHalfUp(total) * sign;
  }

  throw new Error(`computeTiered: unknown tier_mode: ${mode}`);
}
