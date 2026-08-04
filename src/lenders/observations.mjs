/* Bureau observation write path — flags mismatch when observed ≠ expected. */

import { parseBureaus } from "./match.mjs";
import { OBSERVATION_SOURCES, OBSERVATION_REVIEW_STATUSES } from "./tables.mjs";

/**
 * @param {string|null|undefined} expectedRaw
 * @param {string|null|undefined} observed
 * @returns {boolean}
 */
export function isBureauMismatch(expectedRaw, observed) {
  const obs = String(observed || "").trim();
  if (!obs) return false;
  const expected = parseBureaus(expectedRaw);
  if (!expected.length) return true; // observed something but lender record empty → review
  const obsNorm = parseBureaus(obs);
  if (!obsNorm.length) return true;
  return !obsNorm.some((o) => expected.includes(o));
}

/**
 * Build a row ready for INSERT. Does not touch the database.
 * @param {object} input
 */
export function buildObservation(input = {}) {
  const expected = input.expected_bureaus_raw ?? null;
  const observed = input.observed_bureau ?? null;
  const source = String(input.observation_source || "manual").trim();
  const review = String(input.review_status || "pending").trim();
  const mismatch =
    input.mismatch_flag != null
      ? !!input.mismatch_flag
      : isBureauMismatch(expected, observed);

  return {
    application_id: input.application_id || null,
    client_id: input.client_id || null,
    funding_round_id: input.funding_round_id || null,
    lender_name: input.lender_name || null,
    lender_table: input.lender_table || null,
    lender_row_id: input.lender_row_id || null,
    expected_bureaus_raw: expected,
    observed_bureau: observed,
    observation_source: OBSERVATION_SOURCES.includes(source) ? source : "manual",
    mismatch_flag: mismatch,
    review_status: OBSERVATION_REVIEW_STATUSES.includes(review) ? review : "pending",
    notes: input.notes || null,
    created_by: input.created_by || null
  };
}
