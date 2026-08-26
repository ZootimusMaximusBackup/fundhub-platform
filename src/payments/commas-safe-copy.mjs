/* Outbound Commas copy guard — HARDEST RULE (owner-set 2026-08-24).
 *
 * No API call may reach Commas with credit/funding language in product title,
 * description, or legacy checkout URL description. Fail closed. */

export const COMMAS_BANNED_SUBSTRINGS = Object.freeze([
  "credit",
  "finance",
  "financial",
  "funding",
  "fund",
  "deposit",
  "fee",
  "repair",
  "capital",
  "loan",
  "lender",
  "bureau",
  "underwrite",
  "stacking",
  "mastery",
  "fico",
  "score",
  "inquiry"
]);

export function commasCopyViolation(str) {
  const hay = String(str || "").trim().toLowerCase();
  if (!hay) return null;
  for (const needle of COMMAS_BANNED_SUBSTRINGS) {
    if (hay.includes(needle)) return needle;
  }
  return null;
}

export function isCommasSafeCopy(str) {
  return commasCopyViolation(str) == null;
}

/** @throws {Error} code commas_unsafe_copy */
export function assertCommasSafeCopy(str, { field = "copy" } = {}) {
  const hit = commasCopyViolation(str);
  if (hit) {
    const err = new Error(`Commas ${field} contains banned term "${hit}"`);
    err.code = "commas_unsafe_copy";
    throw err;
  }
}
