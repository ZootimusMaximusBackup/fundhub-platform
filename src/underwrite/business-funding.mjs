// COMPLIANCE REVIEW REQUIRED — funding / pre-approval amounts.
// Extra businesses raise the shown pre-approval by applying the existing
// UnderwriteIQ Lite business slice once per saved company.
//
// Documented formula (src/underwrite/vendor/underwriter.cjs:277-286):
//   age < 12 months → 0.5 × primary card funding
//   age < 24 months → 1.0 × primary card funding
//   age ≥ 24 months → 2.0 × primary card funding
//   unknown age     → 0 (same as the engine; no invented default)
//
// One company with a known age is unchanged. Two companies with the same
// known age double the business slice. No new multiplier was invented.

export function businessAgeMultiplier(ageMonths) {
  if (ageMonths == null || ageMonths === "") return 0;
  const n = Number(ageMonths);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n < 12) return 0.5;
  if (n < 24) return 1.0;
  return 2.0;
}

export function businessFundingDollars(cardFunding, ageMonths) {
  const card = Number(cardFunding);
  if (!Number.isFinite(card) || card <= 0) return 0;
  return card * businessAgeMultiplier(ageMonths);
}

export function finiteAgeMonths(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.trim().toLowerCase() === "null") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * One age per listed company. A row with no age_months uses the client's
 * stored business_age_months. Zero listed rows means zero business money.
 *
 * F15, owner-set 2026-09-03: no company row, no business funding. The loose
 * clients.custom_fields.business_age_months used to be enough on its own, so a
 * client whose own record reads "No businesses on file" was quoted roughly
 * $740,000 of business funding on a client-facing sales slide. An age is a
 * property of a company; with no company there is nothing to age, and the
 * fallback now only fills in a blank date on a company that actually exists.
 */
export function resolveBusinessAges({ businesses = [], fallbackAgeMonths = null } = {}) {
  const fallback = finiteAgeMonths(fallbackAgeMonths);
  const rows = Array.isArray(businesses) ? businesses : [];
  if (rows.length === 0) return [];
  return rows.map((biz) => finiteAgeMonths(biz?.age_months) ?? fallback);
}

export function stackedBusinessFunding(cardFunding, ages) {
  const list = Array.isArray(ages) ? ages : [];
  let total = 0;
  for (const age of list) total += businessFundingDollars(cardFunding, age);
  return total;
}

/**
 * Replaces the one-shop business slice on a computeUnderwrite result with
 * the same slice summed across every resolved age. Empty ages leave the
 * engine output untouched.
 */
export function applyStackedBusinessFunding(underwrite, ages) {
  if (!underwrite || typeof underwrite !== "object") return underwrite;
  const list = Array.isArray(ages) ? ages : [];
  if (list.length === 0) return underwrite;

  const key = underwrite.primary_bureau;
  const cardFunding = Number(underwrite.per_bureau?.[key]?.cardFunding) || 0;
  const stacked = stackedBusinessFunding(cardFunding, list);
  const personal = Number(underwrite.totals?.total_personal_funding) || 0;

  return {
    ...underwrite,
    business: {
      ...(underwrite.business && typeof underwrite.business === "object" ? underwrite.business : {}),
      business_funding: stacked,
      can_business_fund: stacked > 0
    },
    totals: {
      ...(underwrite.totals && typeof underwrite.totals === "object" ? underwrite.totals : {}),
      total_business_funding: stacked,
      total_combined_funding: personal + stacked
    }
  };
}

/**
 * Stored CRS pre-approvals are one-shop. When staff saved more companies,
 * replay the same business dollars once per company.
 * Zero or one company keeps the stored combined total.
 */
export function stackedCombinedFromStored({
  totalPersonal,
  totalBusiness,
  totalCombined,
  businessCount
} = {}) {
  const n = Number(businessCount);
  const personal = Number(totalPersonal);
  const business = Number(totalBusiness);
  if (Number.isInteger(n) && n > 1 && Number.isFinite(personal) && Number.isFinite(business)) {
    return personal + business * n;
  }
  const combined = Number(totalCombined);
  return Number.isFinite(combined) ? combined : null;
}
