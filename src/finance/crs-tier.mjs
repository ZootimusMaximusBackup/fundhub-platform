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
 * @param {object} [deps]
 * @param {Function} [deps.runEngine]  test seam; defaults to vendored runCRSEngine
 */
export function runTierEngineFromCrsResult(
  merged,
  {
    submittedName = "",
    submittedAddress = "",
    formData = null,
    businessReport = null
  } = {},
  { runEngine = runCRSEngine } = {}
) {
  const rawResponses = rawResponsesFromMerged(merged);
  const expectedBureaus = (Array.isArray(merged.bureausPulled) ? merged.bureausPulled : [])
    .map((code) => CODE_TO_NAME[code])
    .filter(Boolean);

  const result = runEngine({
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

  if (!result?.ok || !result.outcome) {
    throw new Error("runTierEngineFromCrsResult: engine returned no outcome tier");
  }
  return result;
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
