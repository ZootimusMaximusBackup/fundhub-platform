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
//
// 2026-08-06 REVIEW — full upstream tree was vendored to vendor/underwriteiq/
// for inspection. Owner decision: KEEP THIS LIVE SNAPSHOT. The fresh
// api/lite/underwriter.js had restored `liteBannerFunding = 15000`; this live
// copy keeps `null` (fixtures.test.mjs enforces it). Duplicate underwriter.js
// and suggestions.js were deleted from vendor/underwriteiq/ so they cannot be
// imported by mistake. All other files under vendor/underwriteiq/ stay, unwired.
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
 * ⚠️ `lite_banner_funding` IS NULL when the engine computed no card funding at
 * all — see the last lines of the vendored file. There is no display-floor
 * number anymore: null means no figure is available, not a placeholder one.
 * ./report.mjs flags it as such whenever no figure was computed, so no screen
 * can print the null as $0, NaN, or blank.
 */
/** Safe empty underwrite — used when the vendored engine throws or gets a
 *  non-object result. utilization_pct stays null (never 0). No lender list is
 *  invented. Charts that suppress on missing data stay honest. */
const SAFE_EMPTY_UNDERWRITE = Object.freeze({
  fundable: false,
  primary_bureau: "experian",
  metrics: Object.freeze({
    score: 0,
    utilization_pct: null,
    negative_accounts: 0,
    late_payment_events: 0,
    inquiries: Object.freeze({ ex: 0, eq: 0, tu: 0, total: 0 })
  }),
  per_bureau: Object.freeze({
    experian: Object.freeze({ available: false, score: 0, util: null, tradelines: Object.freeze([]) }),
    equifax: Object.freeze({ available: false, score: 0, util: null, tradelines: Object.freeze([]) }),
    transunion: Object.freeze({ available: false, score: 0, util: null, tradelines: Object.freeze([]) })
  }),
  personal: Object.freeze({
    highest_revolving_limit: 0,
    highest_installment_amount: 0,
    can_card_stack: false,
    can_loan_stack: false,
    can_dual_stack: false,
    card_funding: 0,
    loan_funding: 0,
    total_personal_funding: 0
  }),
  business: Object.freeze({
    business_age_months: null,
    can_business_fund: false,
    business_multiplier: 0,
    business_funding: 0
  }),
  totals: Object.freeze({
    total_personal_funding: 0,
    total_business_funding: 0,
    total_combined_funding: 0
  }),
  optimization: Object.freeze({
    needs_util_reduction: false,
    target_util_pct: null,
    needs_new_primary_revolving: true,
    needs_inquiry_cleanup: false,
    needs_negative_cleanup: false,
    needs_file_buildout: true,
    thin_file: true,
    file_all_negative: false
  }),
  lite_banner_funding: null,
  /** Never invent a lender shortlist when CRS data was bad or missing. */
  lenders: Object.freeze([])
});

const SAFE_EMPTY_BUREAU = Object.freeze({
  available: false,
  score: null,
  utilization_pct: null,
  inquiries: null,
  negatives: null,
  late_payment_events: null,
  names: Object.freeze([]),
  addresses: Object.freeze([]),
  employers: Object.freeze([]),
  tradelines: Object.freeze([])
});

/** Fallback suggestion when uw is missing — no utilization / lender claims. */
const SAFE_EMPTY_SUGGESTIONS = Object.freeze([
  "You're close to approval. A few targeted improvements will push you into approval range."
]);

/**
 * computeUnderwrite — never throws. Hostile or corrupt CRS shapes (throwing
 * getters, broken tradelines) return SAFE_EMPTY_UNDERWRITE instead of crashing
 * the deliverables path.
 */
export function computeUnderwrite(bureaus, businessAgeMonthsRaw) {
  try {
    const result = underwriter.computeUnderwrite(bureaus, businessAgeMonthsRaw);
    if (!result || typeof result !== "object") return SAFE_EMPTY_UNDERWRITE;

    // Charts suppress on missing util — never ship NaN/Infinity as a measured %.
    const util = result.metrics?.utilization_pct;
    if (util != null && !Number.isFinite(Number(util))) {
      return {
        ...result,
        metrics: { ...result.metrics, utilization_pct: null }
      };
    }

    // Vendor does not emit lenders. If a bad shape somehow stamped a non-array
    // "lender list", strip it — never invent names for unlock_ladder.
    if (Object.prototype.hasOwnProperty.call(result, "lenders") && !Array.isArray(result.lenders)) {
      return { ...result, lenders: [] };
    }
    return result;
  } catch {
    return SAFE_EMPTY_UNDERWRITE;
  }
}

/**
 * normalizeBureau — never throws. Missing / hostile bureau → unavailable empty.
 */
export function normalizeBureau(raw) {
  try {
    const b = underwriter.normalizeBureau(raw);
    if (!b || typeof b !== "object") return { ...SAFE_EMPTY_BUREAU, names: [], addresses: [], employers: [], tradelines: [] };
    // NaN / non-finite utilization must not become a chartable number.
    const util = b.utilization_pct;
    if (util != null && !Number.isFinite(Number(util))) {
      return { ...b, utilization_pct: null };
    }
    return b;
  } catch {
    return { ...SAFE_EMPTY_BUREAU, names: [], addresses: [], employers: [], tradelines: [] };
  }
}

/**
 * getNumberField — never throws. Absent / hostile → null.
 */
export function getNumberField(fields, key) {
  try {
    return underwriter.getNumberField(fields, key);
  } catch {
    return null;
  }
}

/**
 * buildSuggestions — never throws. null/undefined uw → safe fallback line only
 * (no utilization or lender-list claims invented from missing data).
 */
export function buildSuggestions(uw, user = {}) {
  try {
    if (uw == null || typeof uw !== "object") {
      return [...SAFE_EMPTY_SUGGESTIONS];
    }
    const out = suggestions.buildSuggestions(uw, user);
    return Array.isArray(out) && out.length > 0 ? out : [...SAFE_EMPTY_SUGGESTIONS];
  } catch {
    return [...SAFE_EMPTY_SUGGESTIONS];
  }
}

export { SAFE_EMPTY_UNDERWRITE };

export default {
  UPSTREAM,
  computeUnderwrite,
  normalizeBureau,
  getNumberField,
  buildSuggestions,
  SAFE_EMPTY_UNDERWRITE
};
