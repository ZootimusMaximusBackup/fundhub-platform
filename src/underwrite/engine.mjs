// UnderwriteIQ Lite — THE BOUNDARY. This is the only file in fundhub that knows
// where the vendored engine lives or what shape it arrives in.
//
// ═══════════════════════════════════════════════════════════════════════════════
// UPSTREAM PROVENANCE — UPDATE THESE THREE FACTS TOGETHER OR NOT AT ALL
//
//   repo:   https://github.com/darwin808/underwrite-iq-lite
//   commit: 71656f0fe1083429f52eeb0aa095cce076a6b33c
//   files:  api/lite/underwriter.js  -> ./vendor/underwriter.cjs
//           api/lite/suggestions.js  -> ./vendor/suggestions.cjs
//
// The two files under ./vendor/ are BYTE-FOR-BYTE COPIES of upstream at that
// commit. Verified by sha256 at vendoring time and re-asserted on every test run
// by ./fixtures.test.mjs, which pins the exact suggestion strings the engine
// emits. Refreshing from upstream is: copy the two files, change the commit sha
// above, run the tests. Nothing else in this repo imports ./vendor/ — that is the
// whole point of this module existing.
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHY VERBATIM .cjs FILES AND A STATIC IMPORT, RATHER THAN A HAND-PORT TO ESM OR
// createRequire(). Three options were on the table and this one wins on the same
// axis each time — what does the NEXT upstream refresh cost:
//
//   * Hand-port CJS -> ESM. Rejected. Every future refresh means redoing the
//     conversion and re-reviewing it, on a file whose arithmetic decides what a
//     client is told about their funding. A one-character slip during a
//     mechanical edit is invisible in review and changes the output. Verbatim
//     copies make the refresh a `cp` and the diff against upstream exactly empty.
//
//   * createRequire(import.meta.url). Rejected, though it would also keep the
//     files verbatim. The specifier is then a runtime string, and this repo
//     deploys through Netlify's function bundler, which traces STATIC imports to
//     decide what to ship. A dependency it cannot see is a dependency it does not
//     bundle, and the failure lands at runtime on the deploy target rather than
//     in any test here. `netlify/functions/api.mjs` exists because this repo has
//     already shipped "works locally, 404s deployed" twice; not volunteering a
//     third variant of it.
//
//   * Verbatim + `.cjs` + static default import. CHOSEN. package.json is
//     `"type": "module"`, so a `.js` file here would be parsed as ESM and its
//     `module.exports` would throw on load. `.cjs` tells Node to parse it as
//     CommonJS. The file CONTENT is untouched — only the extension differs from
//     upstream — and `import x from "./vendor/underwriter.cjs"` is a static
//     specifier every bundler can follow.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHAT THE ENGINE IS, AND FOUR THINGS ABOUT IT THAT WILL BITE A CALLER
//
// The engine takes bureau data and returns a funding assessment plus a list of
// English sentences. Those sentences are the product. This repo does not rewrite
// them, soften them, or add to them — see api/read/underwrite.mjs.
//
// (1) IT IS NOT PURE. IT READS THE CLOCK.
//     `computeUnderwrite` -> buildBureauSummary -> monthsSince(tl.opened) calls
//     `new Date()`. A tradeline is "seasoned" at >= 24 months old, and seasoning
//     gates every funding figure the engine produces. So the same input can
//     produce a different answer next year. This contradicts what this repo
//     demands of its own rule modules (src/alerts/evaluate.mjs is emphatic that
//     a report you cannot reproduce is not evidence of anything).
//
//     NOT FIXED HERE, DELIBERATELY. Patching it would fork the vendored file and
//     forfeit the byte-identical refresh this whole module is built around. It is
//     instead CONTAINED: ./fixtures.test.mjs only uses `opened` values that sit
//     in the clock-stable region (see that file), so the pinned fixtures cannot
//     rot into a false drift alarm. Recorded as a finding, not worked around.
//
// (2) IT COLLAPSES UNKNOWN TO ZERO, WHICH THIS REPO NEVER DOES.
//     Inside the engine, `numOrZero()` turns a null negatives / inquiries /
//     late-payments count into 0, and each bureau summary reports `score ?? 0`.
//     So a client whose negatives nobody has entered is scored as a client with
//     ZERO negatives — and `fundable` requires `neg === 0`. An unknown reads as
//     a clean file.
//
//     This is the exact inversion of the rule 083/084/054 and evaluate.mjs are
//     built on: NULL means UNKNOWN and must survive. Again not patched, for the
//     same refresh reason. It is contained on OUR side instead: ./adapter.mjs
//     reports every field it could not fill, and ./report.mjs marks any
//     suggestion resting on one of those fields so the endpoint can name the
//     missing field instead of rendering a confident sentence built on nulls.
//     A zero from this engine is never presented as a measured zero.
//
// (3) IT WORKS IN DOLLARS. THIS REPO STORES CENTS.
//     `tl.limit` and `tl.balance` are compared against 5000 and 10000, and
//     funding is a dollar figure. fundhub stores integer cents everywhere
//     (src/commissions/money.mjs). ./adapter.mjs does that conversion exactly
//     once, on the way in. Nothing downstream re-converts.
//
// (4) UTILIZATION IS PERCENT UNITS, NOT A FRACTION.
//     `utilization_pct` is compared against 30, 50 and 80. So 30 means 30%.
//     Note this is the OPPOSITE convention to src/alerts/evaluate.mjs, whose
//     threshold is a decimal fraction (0.30 means 30%), and to
//     src/finance/os-grid.mjs, whose utilization row is a fraction. Converting
//     between them is a single multiply and it is a single place: ./adapter.mjs.
//     Getting this wrong by a factor of 100 makes every client look either
//     perfect or maxed out, and both read as plausible.

import underwriter from "./vendor/underwriter.cjs";
import suggestions from "./vendor/suggestions.cjs";

/** The upstream commit these vendored files were copied from. Asserted in
 *  ./fixtures.test.mjs so the sha and the files cannot drift apart silently. */
export const UPSTREAM = Object.freeze({
  repo: "https://github.com/darwin808/underwrite-iq-lite",
  commit: "71656f0fe1083429f52eeb0aa095cce076a6b33c",
  files: Object.freeze({
    "api/lite/underwriter.js": "vendor/underwriter.cjs",
    "api/lite/suggestions.js": "vendor/suggestions.cjs"
  })
});

/**
 * computeUnderwrite(bureaus, businessAgeMonthsRaw) — the funding assessment.
 *
 * @param {object} bureaus  { experian, equifax, transunion }, each in the shape
 *        normalizeBureau produces. A missing key is handled by the engine and
 *        becomes `available: false`.
 * @param {number|null} businessAgeMonthsRaw  months, or null. Anything that is
 *        not a finite number is treated as null by the engine.
 * @returns {object} { fundable, primary_bureau, metrics, per_bureau, personal,
 *          business, totals, optimization, lite_banner_funding }
 *
 * ⚠️ `lite_banner_funding` FALLS BACK TO A HARDCODED 15000 when the engine
 * computed no card funding at all — see the last lines of the vendored file. It
 * is a display floor upstream chose, NOT a computed figure and NOT an amount
 * anybody is approved for. ./report.mjs flags it as such whenever the fallback
 * fired, so no screen can print it as a result.
 */
export const computeUnderwrite = underwriter.computeUnderwrite;

/**
 * normalizeBureau(raw) — one bureau's data into the engine's fixed shape.
 * Returns `{ available: false }` plus all-null measures and empty arrays for a
 * missing or non-object bureau. `available: true` means A BUREAU OBJECT WAS
 * SUPPLIED — not that any field inside it is populated.
 */
export const normalizeBureau = underwriter.normalizeBureau;

/**
 * getNumberField(fields, key) — read one numeric value out of a form-fields bag,
 * tolerating the `{ key: [value] }` shape multipart parsers produce. Returns null
 * for absent, non-numeric or non-finite. Used here to read business age.
 */
export const getNumberField = underwriter.getNumberField;

/**
 * buildSuggestions(uw, user = {}) — the engine's own English sentences.
 *
 * @param {object} uw  a computeUnderwrite return value
 * @param {object} [user]  { hasLLC, llcAgeMonths }
 * @returns {string[]} never empty — it has a fallback line
 *
 * ⚠️ `user` DEFAULTS ARE NOT MEASUREMENTS. Omitted, `hasLLC` is false and
 * `llcAgeMonths` is 0, and the LLC branch always emits a sentence on that basis.
 * fundhub stores no LLC field at all, so that sentence would rest entirely on a
 * default. ./report.mjs marks it accordingly rather than letting it read as a
 * finding about the client.
 */
export const buildSuggestions = suggestions.buildSuggestions;

export default {
  UPSTREAM,
  computeUnderwrite,
  normalizeBureau,
  getNumberField,
  buildSuggestions
};
