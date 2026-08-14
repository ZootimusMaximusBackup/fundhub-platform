// Softview pull → 6-tier engine.
//
// Fundhub stores each bureau's raw Softview JSON under result.bureaus.TU|EX|EQ.
// The vendored CRS engine wants that same JSON as a rawResponses array. This
// module unwraps the map and calls runCRSEngine. It does NOT re-normalize the
// flat tradelines/scores Fundhub already derived — those are a different shape.

import crsEngine from "./vendor/crs-engine.cjs";

const { runCRSEngine } = crsEngine;

export const CODE_TO_NAME = Object.freeze({
  TU: "transunion",
  EX: "experian",
  EQ: "equifax"
});

/** Exact 6-tier ladder. No aliases, no trim, no case-fold. Do not invent tiers. */
export const OUTCOME_TIERS = Object.freeze([
  "FRAUD_HOLD",
  "MANUAL_REVIEW",
  "REPAIR_ONLY",
  "FUNDING_PLUS_REPAIR",
  "FULL_FUNDING",
  "PREMIUM_STACK"
]);

const OUTCOME_TIER_SET = new Set(OUTCOME_TIERS);

export function isKnownOutcomeTier(value) {
  return typeof value === "string" && OUTCOME_TIER_SET.has(value);
}

/**
 * stampOutcomeTier — CRS-row outcome_tier vs engine guess.
 *
 * Winner: an exact known 6-tier stamp ALWAYS wins. The engine guess is used
 * only when the stamp is missing or not an exact known name.
 *
 * Why stamp wins:
 * - Funding samples (FULL_FUNDING / FUNDING_PLUS_REPAIR / PREMIUM_STACK)
 *   must not become MANUAL_REVIEW when the engine guesses review.
 * - MANUAL_REVIEW / FRAUD_HOLD stamps must stay review/hold even if the
 *   engine guesses a funding path.
 *
 * Fail closed: unknown/garbage stamp + unknown/missing guess -> MANUAL_REVIEW,
 * never FULL_FUNDING.
 */
export function stampOutcomeTier(engineGuess, explicitStamp) {
  if (isKnownOutcomeTier(explicitStamp)) return explicitStamp;
  if (isKnownOutcomeTier(engineGuess)) return engineGuess;
  return "MANUAL_REVIEW";
}

function bureauLooksEmpty(report) {
  if (!report || typeof report !== "object") return true;
  const scores = report.scores;
  const tradelines = report.tradelines;
  const hasScores = Array.isArray(scores)
    ? scores.length > 0
    : Boolean(
      scores && typeof scores === "object" && !Array.isArray(scores)
      && Object.keys(scores).length > 0
    );
  const hasTradelines = Array.isArray(tradelines) && tradelines.length > 0;
  return !hasScores && !hasTradelines;
}

function failClosedResult(explicitStamp, reason, engine = null) {
  const guess = engine?.ok && isKnownOutcomeTier(engine.outcome) ? engine.outcome : null;
  const outcome = stampOutcomeTier(guess, explicitStamp);
  const outcomeSource = isKnownOutcomeTier(explicitStamp)
    ? "stamp"
    : (guess ? "engine" : "fail_closed");
  const base = engine && typeof engine === "object" && !Array.isArray(engine) ? { ...engine } : {};
  return {
    ...base,
    ok: outcomeSource !== "fail_closed",
    outcome,
    outcomeSource,
    reason: reason || null
  };
}

/**
 * rawResponsesFromMerged — unwrap Fundhub's stored pull into the array
 * normalizeSoftPullPayload / runCRSEngine expect.
 *
 * @param {object} merged  crs_results.result from mergeBureauReports
 * @returns {object[]}
 */
export function rawResponsesFromMerged(merged) {
  if (!merged || typeof merged !== "object") {
    throw new Error("rawResponsesFromMerged: expected a merged pull payload");
  }
  const codes = Array.isArray(merged.bureausPulled) && merged.bureausPulled.length
    ? merged.bureausPulled
    : ["TU", "EX", "EQ"];
  const rawResponses = codes
    .map((code) => merged.bureaus?.[code])
    .filter((report) => report && typeof report === "object" && !Array.isArray(report));

  if (rawResponses.length === 0) {
    throw new Error("rawResponsesFromMerged: no bureau reports to score");
  }
  return rawResponses;
}

/**
 * runTierEngineFromCrsResult — smallest bridge onto the 6-tier engine.
 *
 * @param {object} merged
 * @param {object} [opts]
 * @param {string} [opts.submittedName]
 * @param {string} [opts.submittedAddress]
 * @param {object} [opts.formData]
 * @param {object|null} [opts.businessReport]
 * @param {string|null} [opts.outcomeTier]  exact CRS-row stamp; wins over engine guess
 * @param {object} [deps]
 * @param {Function} [deps.runEngine]  test seam; defaults to vendored runCRSEngine
 */
export function runTierEngineFromCrsResult(
  merged,
  {
    submittedName = "",
    submittedAddress = "",
    formData = null,
    businessReport = null,
    outcomeTier = null
  } = {},
  { runEngine = runCRSEngine } = {}
) {
  let rawResponses;
  try {
    rawResponses = rawResponsesFromMerged(merged);
  } catch {
    return failClosedResult(outcomeTier, "no_bureau_reports");
  }

  if (rawResponses.every(bureauLooksEmpty) && !isKnownOutcomeTier(outcomeTier)) {
    return failClosedResult(outcomeTier, "missing_scores_or_tradelines");
  }

  const expectedBureaus = (Array.isArray(merged.bureausPulled) ? merged.bureausPulled : [])
    .map((code) => CODE_TO_NAME[code])
    .filter(Boolean);

  let result;
  try {
    result = runEngine({
      rawResponses,
      businessReport,
      submittedName,
      submittedAddress,
      expectedBureaus: expectedBureaus.length ? expectedBureaus : undefined,
      formData: formData || {
        name: submittedName || null,
        email: null,
        phone: null
      }
    });
  } catch {
    return failClosedResult(outcomeTier, "engine_threw");
  }

  if (!result || typeof result !== "object" || !result.ok || !isKnownOutcomeTier(result.outcome)) {
    return failClosedResult(outcomeTier, "engine_no_outcome", result);
  }

  const outcome = stampOutcomeTier(result.outcome, outcomeTier);
  return {
    ...result,
    outcome,
    outcomeSource: isKnownOutcomeTier(outcomeTier) ? "stamp" : "engine"
  };
}

/** Format helpers for the identity object runCrsPull already holds. */
export function submittedNameFromIdentity(identity) {
  if (!identity || typeof identity !== "object") return "";
  return `${identity.firstName || ""} ${identity.lastName || ""}`.trim();
}

export function submittedAddressFromIdentity(identity) {
  if (!identity || typeof identity !== "object") return "";
  const address = Array.isArray(identity.addresses) ? identity.addresses[0] : identity.address;
  if (!address || typeof address !== "object") return "";
  return [
    address.addressLine1 || address.line1,
    address.city,
    address.state,
    address.postalCode || address.zip
  ].filter(Boolean).join(", ");
}
