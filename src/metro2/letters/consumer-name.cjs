// ═══════════════════════════════════════════════════════════════════════════════
// IS THIS STRING A PERSON'S NAME? THE ONE PLACE THAT DECIDES.
//
// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// THE RULE, and it is one rule for every document that leaves this building:
//
//   A person's name printed on a letter to a credit bureau, to a furnisher, or
//   on a complaint sworn under penalty of perjury is EITHER A REAL NAME OR IT IS
//   ABSENT. There is no third answer. A document that cannot be truthfully
//   addressed REFUSES to be built. Nothing substitutes a word for the name —
//   not "Client", not "Consumer", not a bracketed blank.
//
// WHY THIS FILE EXISTS RATHER THAN A CHECK AT EACH SITE. Two rounds of review
// closed this defect one site at a time and both times the class survived
// somewhere nobody had enumerated: round 2 gated the three metro2 renderers and
// recorded "there are exactly three places"; a reviewer then found five, two of
// them outside src/. A predicate that lives in one file and is imported by every
// renderer cannot be half-applied.
//
// COMMONJS ON PURPOSE. `vendor/underwriteiq-full/api/lite/letter-generator.js`
// is CommonJS and prints a consumer name onto three different mailed PDFs. A
// CommonJS module can be `require`d by it AND default-imported by every .mjs in
// src/, so both families run the same list. ./consumer-name.mjs is the ESM face
// of this file and adds nothing of its own.
//
// WHAT COUNTS AS NOT-A-NAME. Only a WHOLE value that is one of the words below,
// or a bracketed blank, or a value with no letter in it. A component match is
// deliberately not enough: "Pat Client" is somebody's actual name and must still
// get their letters. Real-looking placeholder names ("John Doe") are NOT on the
// list — refusing those would deny a real person with that name their letters,
// which is a worse harm than the one this file prevents.
// ═══════════════════════════════════════════════════════════════════════════════

/** The reason every renderer answers with when the name is not a person's. */
const NO_CONSUMER_NAME = "missing_consumer_name";

/**
 * Whole-string values that are a stand-in for a name, never a name.
 * Compared case-insensitively with internal whitespace collapsed and trailing
 * punctuation removed.
 */
const NOT_A_NAME = Object.freeze([
  "client",
  "clients",
  "the client",
  "consumer",
  "the consumer",
  "customer",
  "the customer",
  "applicant",
  "borrower",
  "member",
  "user",
  "subject",
  "name",
  "your name",
  "full name",
  "legal name",
  "full legal name",
  "consumer name",
  "client name",
  "first last",
  "firstname lastname",
  "first name last name",
  "test",
  "test client",
  "test consumer",
  "sample",
  "example",
  "anonymous",
  "unknown",
  "not provided",
  "not available",
  "none",
  "n a",
  "na",
  "nil",
  "null",
  "undefined",
  "tbd",
  "pending",
  "redacted"
]);

const NOT_A_NAME_SET = new Set(NOT_A_NAME);

/** Lowercase, collapse whitespace, drop surrounding punctuation. */
function normalizeForCompare(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[.,;:!?_*"'`]/g, " ")
    .replace(/[/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `value` is a stand-in rather than a person's name.
 * An empty or missing value is also not a name.
 */
function isPlaceholderName(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return true;
  // A bracketed blank — "[Consumer Name]", "[FULL LEGAL NAME]", "<name>", "{{name}}".
  if (/^[[<{(]/.test(raw) && /[\]>})]$/.test(raw)) return true;
  /* Nothing a person could be called: no letter anywhere in it. \p{L} and not an
     ASCII range on purpose — "李" is a real name and a bureau letter addressed to
     it must be built. Caught by src/underwrite/letter-generator.test.mjs
     "smash: unicode and apostrophe names still render a real PDF", which an
     A-Z-only test would have failed. */
  if (!/\p{L}/u.test(raw)) return true;
  return NOT_A_NAME_SET.has(normalizeForCompare(raw));
}

/**
 * The person's name, or NULL when there is not one.
 *
 * NULL MEANS UNKNOWN and every caller must let it stay unknown. Do not `||` a
 * word onto the end of this call — that is the exact defect this file closes.
 *
 * @param {*} value
 * @returns {string|null} the trimmed name, whitespace collapsed, or null
 */
function realConsumerName(value) {
  if (isPlaceholderName(value)) return null;
  return String(value).trim().replace(/\s+/g, " ");
}

/**
 * Throw the shared refusal when there is no real name.
 * Used by the renderers whose refusal channel is an exception.
 *
 * @param {*} value
 * @param {string} what  the document being refused, for the message
 * @returns {string} the real name
 */
function requireConsumerName(value, what = "document") {
  const name = realConsumerName(value);
  if (!name) {
    throw new Error(
      `${NO_CONSUMER_NAME} — refuse to build a ${what} addressed in a name that is not a person's`
    );
  }
  return name;
}

module.exports = {
  NO_CONSUMER_NAME,
  NOT_A_NAME,
  isPlaceholderName,
  realConsumerName,
  requireConsumerName
};
