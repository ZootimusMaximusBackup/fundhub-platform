/** Lender display-name helpers. Tip rows are notes, not banks. */

const NOISE = /\s*\([^)]*\)\s*/g;
const PUNCT = /[^a-z0-9]+/g;

/** @param {string} name */
export function normalizeName(name) {
  return String(name || "")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} name */
export function slugFromName(name) {
  const base = normalizeName(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(PUNCT, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "unknown";
}

/** Rows that are tips, not banks. */
export function isTipRow(name) {
  return /^(apply |amex often|if |when |note:|same |use |do not|must |can |should |wait |open |call |visit )/i.test(name)
    || String(name).length > 72;
}
