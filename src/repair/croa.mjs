// CROA intake gates — 3 business days before leaving intake; contract content checks.

const REQUIRED_CONTRACT_KEYS = Object.freeze([
  "terms_and_cost",
  "services_description",
  "estimated_timeline",
  "business_name_address",
  "cancellation_notice",
  "disclosure_delivered_at"
]);

/** Next business day after d (Mon–Fri). */
export function addBusinessDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new TypeError("invalid date");
  let left = Number(days);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export function croaReleaseDate(enrolledAtIso) {
  const day = String(enrolledAtIso).slice(0, 10);
  return addBusinessDays(day, 3);
}

/**
 * Can the case leave intake?
 * Contract keys still required. The 3-business-day hold was removed (owner
 * 2026-08-21) — letters may generate and mail after payment. croaReleaseDate
 * remains exported for any caller that still wants the calendar math.
 * COMPLIANCE REVIEW REQUIRED
 * @returns {{ ok: true, releaseDate } | { ok: false, reason, releaseDate? }}
 */
export function canLeaveIntake({ enrolledAt, asOf, contract }) {
  if (!enrolledAt) return { ok: false, reason: "missing_enrolled_at" };
  const missing = REQUIRED_CONTRACT_KEYS.filter((k) => !contract?.[k]);
  if (missing.length) return { ok: false, reason: "contract_incomplete", missing };
  const releaseDate = croaReleaseDate(enrolledAt);
  void asOf;
  return { ok: true, releaseDate };
}

export { REQUIRED_CONTRACT_KEYS };
