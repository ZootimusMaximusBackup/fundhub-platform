// Soft-pull diagnostic price: base assessment + optional business add-ons.
// COMPLIANCE REVIEW REQUIRED — fee timing / payment rails.
// Owner 2026-08-24: base $32 + $10 per business, 0–5 businesses.

import { getOffer, formatCents } from "../config/offers.mjs";

export const SOFT_PULL_BUSINESS_ADDON_CENTS = 1000;
export const SOFT_PULL_MAX_BUSINESSES = 5;

export function softPullBaseCents() {
  const offer = getOffer("SOFT_PULL");
  return offer?.priceCents ?? 3200;
}

/** softPullTotalCents(businessCount) — base + ($10 × n). n must be 0..5. */
export function softPullTotalCents(businessCount = 0) {
  if (!Number.isInteger(businessCount) || businessCount < 0 || businessCount > SOFT_PULL_MAX_BUSINESSES) {
    throw new RangeError(
      `softPullTotalCents: businessCount must be an integer 0–${SOFT_PULL_MAX_BUSINESSES}, got ${businessCount}`
    );
  }
  return softPullBaseCents() + SOFT_PULL_BUSINESS_ADDON_CENTS * businessCount;
}

export function softPullPricingPublic() {
  const base = softPullBaseCents();
  return {
    base_cents: base,
    base_display: formatCents(base) || "$32",
    business_addon_cents: SOFT_PULL_BUSINESS_ADDON_CENTS,
    business_addon_display: formatCents(SOFT_PULL_BUSINESS_ADDON_CENTS) || "$10",
    max_businesses: SOFT_PULL_MAX_BUSINESSES
  };
}
