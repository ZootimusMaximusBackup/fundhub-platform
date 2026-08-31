// Decline Autopsy — scoring. A REDUCED-INPUT PATH INTO THE ENGINE WE ALREADY
// HAVE. Not a second engine, and nothing here re-implements any arithmetic.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §6.
//
// WHAT IT REUSES, AND NOTHING ELSE:
//   computeUnderwrite        src/underwrite/engine.mjs  (the capacity model)
//   businessFundingDollars   src/underwrite/business-funding.mjs
//   matchLenders             src/lenders/match.mjs      (state + bureau eligibility)
//   toCents / percentOf / applySplit / fromCents  src/commissions/money.mjs
//
// src/crs/snapshot-negatives.mjs is deliberately NOT used: its functions need a
// real CRS result and there is not one. Naming it as reuse would be pretending.
//
// ═══════════════════════════════════════════════════════════════════════════
// DRIFT, FOUND AND FLAGGED — the vendored engine is the truth, the header is
// not. src/underwrite/engine.mjs note (2) says the engine "COLLAPSES UNKNOWN TO
// ZERO", that numOrZero() turns a null negatives / inquiries / late-payments
// count into 0, and that therefore "an unknown reads as a clean file".
//
// Read src/underwrite/vendor/underwriter.cjs lines 33-49. That is not what it
// does. numOrZero() is applied to tradeline `limit` and `balance` ONLY.
// negatives, late_payment_events and inquiries go through measuredCount(), and
// utilization_pct through measuredPct(), both of which return NULL for unknown
// with the comment "Unknown stays null — never 0". So the engine's own
// `fundable` gate — which requires `neg === 0` — is FALSE on an unknown, not
// true: an unknown reads as NOT clean, the exact opposite of the header.
//
// What IS still true of the header: buildBureauSummary reports `score ?? 0`, so
// a missing score is reported as zero inside the per-bureau summary.
//
// CONSEQUENCE FOR THIS FILE, and it is why the buckets below are computed here
// rather than read off the engine: on autopsy input, where negatives are never
// supplied, `underwrite.fundable` is ALWAYS false. Using it as the "fundable
// now" test would put every row in the same bucket for a reason that has
// nothing to do with the deal. The engine is used for CAPACITY, which is what
// it is good at from these inputs, and the bucket is decided from the fields the
// broker actually gave us.
//
// Recorded, not patched: patching the vendored file would forfeit the
// byte-identical upstream refresh that whole module is built around.
// ═══════════════════════════════════════════════════════════════════════════

import { computeUnderwrite } from "../underwrite/engine.mjs";
import { businessAgeMultiplier } from "../underwrite/business-funding.mjs";
import { matchLenders } from "../lenders/match.mjs";
import { applySplit, percentOf, toCents } from "../commissions/money.mjs";
import { BUCKETS, REPAIRABLE_DECLINE_REASONS, ficoMidpoint } from "./fields.mjs";

/** The success fee, in percent units — 10 means 10%. percentOf() takes percent
 *  units (src/commissions/money.mjs). Owner-set, W0-decisions.md. */
export const SUCCESS_FEE_PCT = 10;

/** Partner share, front end and back end. Owner-set and it never moves. */
export const PARTNER_SHARE_PCT = 50;

/** The engine's own thresholds, restated here only as the points a row is
 *  compared against, so the report can print WHY a row landed where it did.
 *  Sourced from src/underwrite/vendor/underwriter.cjs, not invented. */
export const ENGINE_THRESHOLDS = Object.freeze({
  fundableScore: 700,      // `score >= 700`
  utilizationPct: 30,      // `util == null || util <= 30`
  minRevolvingLimit: 5000, // `highestRevolvingLimit >= 5000`
  seasonedMonths: 24       // `ageMonths >= 24`
});

const dollarsToCents = (dollars) => {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return toCents(Math.round(n * 100) / 100);
};

const centsToDollars = (cents) => (cents === null || cents === undefined ? null : cents / 100);

/**
 * bureauShapeFor(row) — the minimal bureau object the engine eats, built ONLY
 * from what the broker actually gave us.
 *
 * ONE BUREAU SLOT, NOT THREE. The broker's numbers describe a consumer, not a
 * bureau. Filling all three slots with the same figures would triple
 * totalCardFundingBase, which sums across available bureaus. One slot keeps the
 * arithmetic honest. It also keeps the engine's `fundableCount === 1` one-third
 * scaling switched off, because `fundable` requires `neg === 0` and negatives
 * are never supplied — see the drift note above.
 *
 * Returns null when there is not enough to build one.
 */
export function bureauShapeFor(row) {
  const midpoint = ficoMidpoint(row?.fico_band);
  if (midpoint === null) return null;

  const limitCents = row?.highest_revolving_limit_cents;
  const opened = row?.revolving_opened_month;
  if (limitCents === null || limitCents === undefined || !opened) return null;

  return {
    experian: {
      score: midpoint,
      utilization_pct: row.revolving_utilization_pct ?? null,
      // negatives / inquiries / late_payment_events are NOT supplied and are NOT
      // defaulted. The engine keeps them null. An unknown must stay unknown.
      tradelines: [
        {
          type: "revolving",
          status: "open",
          limit: centsToDollars(limitCents), // the engine works in dollars
          balance: 0,
          opened: String(opened).slice(0, 7) // YYYY-MM, the shape monthsSince reads
        }
      ]
    }
  };
}

function repairableReason(reason) {
  if (!reason) return true; // no reason given — the band alone placed it; said so in the assumptions
  return REPAIRABLE_DECLINE_REASONS.includes(reason);
}

/**
 * scoreAutopsyRow(row, { lenders, now }) — one row's bucket, capacity and the
 * assumptions that produced them.
 *
 * *** NULL SURVIVES. *** A row we cannot model gets estimated_capacity_cents =
 * null, lands in "not enough information", and is EXCLUDED FROM EVERY TOTAL. It
 * never silently becomes 0 and it never silently becomes an average.
 *
 * @param {object} row               a row from src/autopsy/parse.mjs
 * @param {object[]|null} lenders    the live lender list, or null when it could
 *                                   not be read. NULL IS NOT AN EMPTY LIST: a
 *                                   list we never saw cannot be evidence that
 *                                   nobody would have taken the deal.
 */
export function scoreAutopsyRow(row, { lenders = null, now = new Date() } = {}) {
  const assumptions = [];
  const midpoint = ficoMidpoint(row?.fico_band);

  const bureaus = bureauShapeFor(row);
  if (!bureaus) {
    const missing = [];
    if (midpoint === null) missing.push("FICO band");
    if (row?.highest_revolving_limit_cents === null || row?.highest_revolving_limit_cents === undefined) {
      missing.push("highest revolving limit");
    }
    if (!row?.revolving_opened_month) missing.push("the month that account opened");
    return {
      bucket: BUCKETS.NOT_ENOUGH_INFORMATION,
      estimated_capacity_cents: null,
      estimated_fee_cents: null,
      estimated_partner_share_cents: null,
      lender_match_count: null,
      assumptions: [`Not scored. Missing: ${missing.join(", ")}. We do not estimate from a blank.`]
    };
  }

  assumptions.push(
    `FICO band "${row.fico_band}" was read as its midpoint, ${midpoint}. A band is not a score; the midpoint is an assumption, not a measurement.`
  );
  assumptions.push(
    "Negatives, late payments and hard inquiries were not supplied and were left unknown. They were not counted as zero."
  );

  const uw = computeUnderwrite(bureaus, row.business_age_months ?? null);

  const personalCents = dollarsToCents(uw?.totals?.total_personal_funding);
  const businessCents = dollarsToCents(uw?.totals?.total_business_funding);
  const capacityCents = personalCents + businessCents;

  if (row.business_age_months === null || row.business_age_months === undefined) {
    assumptions.push("No business age was given, so no business-side capacity was added. That is a floor, not a ceiling.");
  } else {
    const mult = businessAgeMultiplier(row.business_age_months);
    assumptions.push(
      `Business age ${row.business_age_months} months applies the engine's ${mult}x business multiplier to the card limit.`
    );
  }

  if (personalCents === 0) {
    assumptions.push(
      `The engine gives no card capacity below a $${ENGINE_THRESHOLDS.minRevolvingLimit.toLocaleString("en-US")} revolving limit that has been open ${ENGINE_THRESHOLDS.seasonedMonths} months. This row was under one of those.`
    );
  }

  /* Lender eligibility. matchLenders invents nothing: an unknown lender state
     means "include", never a made-up restriction (its own header says so). */
  let matchCount = null;
  if (Array.isArray(lenders)) {
    const { matches } = matchLenders({
      lenders,
      clientState: row.state || null,
      inquiryLog: [],
      now
    });
    matchCount = matches.length;
    assumptions.push(
      row.state
        ? `${matchCount} lender${matchCount === 1 ? " on our live list was" : "s on our live list were"} eligible in ${row.state}.`
        : `No state was given, so lender eligibility was counted without a state filter: ${matchCount}.`
    );
  } else {
    assumptions.push("Our lender list was not available when this row was scored, so no lender count is shown.");
  }

  const util = row.revolving_utilization_pct;
  const scoreBlocked = midpoint < ENGINE_THRESHOLDS.fundableScore;
  const utilBlocked = util !== null && util !== undefined && util > ENGINE_THRESHOLDS.utilizationPct;
  const repairBlocked = scoreBlocked || utilBlocked;

  if (scoreBlocked) {
    assumptions.push(
      `The band midpoint is under the engine's own ${ENGINE_THRESHOLDS.fundableScore} approval line, so this row is treated as blocked on the file rather than on capacity.`
    );
  }
  if (utilBlocked) {
    assumptions.push(
      `Revolving utilisation of ${util}% is over the engine's ${ENGINE_THRESHOLDS.utilizationPct}% target.`
    );
  }

  let bucket;
  if (matchCount === null) {
    bucket = BUCKETS.NOT_ENOUGH_INFORMATION;
  } else if (capacityCents <= 0) {
    bucket = BUCKETS.NOT_FUNDABLE;
  } else if (repairBlocked) {
    bucket = repairableReason(row.decline_reason) ? BUCKETS.FUNDABLE_AFTER_REPAIR : BUCKETS.NOT_FUNDABLE;
    if (!row.decline_reason) {
      assumptions.push("No decline reason was given. The band alone placed this row, which is a weaker signal than a stated reason.");
    }
  } else if (matchCount > 0) {
    bucket = BUCKETS.FUNDABLE_NOW;
  } else {
    bucket = BUCKETS.NOT_FUNDABLE;
  }

  /* A row we could not bucket carries no money figure either. Showing capacity
     next to "not enough information" would be the estimate arriving through the
     back door. */
  if (bucket === BUCKETS.NOT_ENOUGH_INFORMATION) {
    return {
      bucket,
      estimated_capacity_cents: null,
      estimated_fee_cents: null,
      estimated_partner_share_cents: null,
      lender_match_count: matchCount,
      assumptions
    };
  }

  const feeCents = percentOf(capacityCents, SUCCESS_FEE_PCT);
  return {
    bucket,
    estimated_capacity_cents: capacityCents,
    estimated_fee_cents: feeCents,
    estimated_partner_share_cents: feeCents > 0 ? applySplit(feeCents, PARTNER_SHARE_PCT) : 0,
    lender_match_count: matchCount,
    assumptions
  };
}

/** scoreAutopsyRows — every row, in order, each carrying its own scoring. */
export function scoreAutopsyRows(rows = [], opts = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, ...scoreAutopsyRow(row, opts) }));
}

export default { scoreAutopsyRow, scoreAutopsyRows, bureauShapeFor, SUCCESS_FEE_PCT, PARTNER_SHARE_PCT };
