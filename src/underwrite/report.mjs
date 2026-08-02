// UnderwriteIQ Lite — the report assembler. Engine output + engine suggestions +
// THE NUMBERS BEHIND EACH SUGGESTION, so an owner can check the reasoning instead
// of taking a sentence on trust.
//
// PURE. No I/O, no clock, no database. Takes a computeUnderwrite result, a
// buildSuggestions result and the adapter's missing-field record; returns the
// response body. The endpoint does the fetching.
//
// ═══════════════════════════════════════════════════════════════════════════════
// HOW A SENTENCE IS TIED BACK TO ITS NUMBERS, AND WHY IT IS A LOOKUP TABLE
//
// `buildSuggestions` returns bare strings. Nothing in the return value says which
// branch produced which line. To show an owner the numbers behind a sentence, we
// have to know which rule fired.
//
// The obvious approach — re-run the same conditions here and label the results —
// is the one thing this integration must not do. Two pieces of code deciding
// "is utilization high" is the defect class this repo keeps finding (054 refuses
// a utilization column, 079 refuses a second fire log, os-grid.mjs exists because
// a waterfall was reimplemented in browser JS). A second copy of the branch
// conditions would agree with the engine right up until upstream changed one.
//
// So this is a LOOKUP TABLE, not a reimplementation. The engine decides; we only
// label what it decided. The key is the exact output string.
//
// THE CATALOGUE IS ALSO THE DRIFT DETECTOR. Every string below is asserted
// against the vendored source by ./fixtures.test.mjs, so a typo here fails
// immediately and an upstream edit to any sentence fails on the next test run
// rather than silently mislabelling advice. A string that arrives without a
// catalogue entry is NOT guessed at — it is returned with `id: null` and
// `recognised: false`, which is visible in the response and impossible to
// mistake for a labelled line.
// ═══════════════════════════════════════════════════════════════════════════════

/** Where a line came from. Both engines speak to utilization, so every
 *  utilization line in this response is stamped with the engine that produced it.
 *  See `utilizationVoices` at the bottom of buildReport. */
export const ENGINES = Object.freeze({
  UNDERWRITE_IQ: "underwrite_iq_lite",
  FUNDHUB_ALERTS: "fundhub_alerts_evaluate"
});

/* The nineteen sentences buildSuggestions can emit, verbatim. Copied out of the
   vendored file programmatically, not retyped — note that "You’re approved" and
   "You're close to approval" use DIFFERENT apostrophes upstream, which is the
   kind of detail a retype loses and an exact-match lookup depends on.

   `dependsOn` names adapter missing-field keys. If a field a sentence rests on
   was never entered, the sentence is marked `restsOnMissingData` and the missing
   field is named — the sentence itself is never altered. */
export const SUGGESTION_CATALOGUE = Object.freeze({
  "Your utilization is extremely high (80%+). Paying balances down aggressively will unlock a large jump in scores and approvals.":
    { id: "utilization_extreme", topic: "utilization", dependsOn: ["utilization_pct"] },
  "Your utilization is high (50–80%). Reducing revolving balances under 30% will significantly improve approval odds and limits.":
    { id: "utilization_high", topic: "utilization", dependsOn: ["utilization_pct"] },
  "Lower your revolving utilization below ~30% for optimal approval odds and limit assignments.":
    { id: "utilization_over_target", topic: "utilization", dependsOn: ["utilization_pct"] },

  "Add a strong primary revolving account (not AU) with a $5,000+ limit to anchor your profile before stacking.":
    { id: "needs_primary_revolving", topic: "primary_revolving", dependsOn: ["tradelines", "opened"] },

  "You have a high number of recent hard inquiries. Cleaning these up will prevent auto-declines and open up better approvals.":
    { id: "inquiries_many", topic: "inquiries", dependsOn: ["inquiries"] },
  "Removing unnecessary or duplicate hard inquiries will improve automated underwriting scores and limit increases.":
    { id: "inquiries_some", topic: "inquiries", dependsOn: ["inquiries"] },

  "You have multiple negative accounts. Prioritize charge-offs and collections first to unlock the biggest score gains.":
    { id: "negatives_many", topic: "negatives", dependsOn: ["negatives"] },
  "You have some negative accounts. Targeted disputes and settlement strategy will help remove them from your reports.":
    { id: "negatives_some", topic: "negatives", dependsOn: ["negatives"] },

  "Your file is mostly negative or very thin. Add 1–2 new primary tradelines and a small installment account to rebuild your foundation.":
    { id: "file_all_negative", topic: "file_buildout", dependsOn: ["tradelines", "negatives", "opened"] },
  "Your file is thin. Add at least one primary credit card and one small installment loan to establish depth.":
    { id: "file_thin_empty", topic: "file_buildout", dependsOn: ["tradelines", "opened"] },
  "Add a couple of additional positive tradelines to strengthen your profile and unlock higher funding tiers.":
    { id: "file_thin_partial", topic: "file_buildout", dependsOn: ["tradelines", "opened"] },

  "You’re approved, but you don’t have an LLC. Forming one now lets you unlock business funding immediately.":
    { id: "llc_absent_fundable", topic: "llc", dependsOn: ["hasLLC"] },
  "You don’t have an LLC yet. Form an LLC now so it can season while your credit is being repaired.":
    { id: "llc_absent_not_fundable", topic: "llc", dependsOn: ["hasLLC"] },
  "Your LLC is under 6 months old. Approvals and limits improve significantly after it seasons past 6 months.":
    { id: "llc_under_6_months", topic: "llc", dependsOn: ["hasLLC"] },
  "Your LLC is seasoning well. Once it matures past 12–24 months, business approvals increase even more.":
    { id: "llc_seasoning", topic: "llc", dependsOn: ["hasLLC"] },
  "Your LLC is fully seasoned. Combined with a strong personal profile, you are positioned for top-tier business limits.":
    { id: "llc_seasoned_fundable", topic: "llc", dependsOn: ["hasLLC"] },
  "Your LLC is seasoned. Once personal cleanup finishes, you will unlock the highest tiers of business approvals.":
    { id: "llc_seasoned_not_fundable", topic: "llc", dependsOn: ["hasLLC"] },

  "Your profile is strong. The next step is proper sequencing and lender selection to maximize total approvals.":
    { id: "fallback_fundable", topic: "fallback", dependsOn: [] },
  "You're close to approval. A few targeted improvements will push you into approval range.":
    { id: "fallback_not_fundable", topic: "fallback", dependsOn: [] }
});

/* Every field name a catalogue entry can depend on. Asserted in the fixture test
   so a new dependsOn value cannot be introduced without a matching adapter gap. */
export const DEPENDENCY_FIELDS = Object.freeze([
  "utilization_pct", "inquiries", "negatives", "late_payment_events",
  "tradelines", "opened", "hasLLC"
]);

/* The engine's own constants, restated here ONLY as the comparison points shown
   next to a number so an owner can see why a branch fired. They are read out of
   the vendored file's conditions and the fixture test pins the behaviour they
   describe. They are NOT used to make any decision in this file. */
const ENGINE_THRESHOLDS = Object.freeze({
  utilization_target_pct: 30,
  utilization_high_pct: 50,
  utilization_extreme_pct: 80,
  inquiries_many: 12,
  negatives_many: 5,
  anchor_revolving_limit_usd: 5000,
  fundable_min_score: 700
});

/* Flatten the adapter's missing record into one set of field names, so a
   dependsOn lookup is a single membership test. A field missing on ANY bureau
   counts as missing — a suggestion built on the primary bureau's null is no more
   trustworthy because a different bureau happened to have the number. */
function missingFieldNames(missing = {}) {
  const names = new Set();
  for (const [, entries] of Object.entries(missing || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      // Informational gaps (per-bureau attribution, unread identity arrays)
      // change no output and must not make every sentence look unreliable.
      if (entry?.informational) continue;
      if (entry?.field) names.add(entry.field);
    }
  }
  return names;
}

/** The full missing-field record for one field name, so the response can name
 *  the field AND say what entering it would change. */
function detailsFor(missing = {}, field) {
  const out = [];
  for (const [scope, entries] of Object.entries(missing || {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry?.field === field && !entry?.informational) out.push({ scope, ...entry });
    }
  }
  return out;
}

/**
 * basisFor — the numbers behind one suggestion, read OFF the engine's own output.
 *
 * Nothing here recomputes anything. Every value is lifted from the
 * computeUnderwrite result, next to the engine constant it was compared against,
 * so an owner reading the sentence can see the arithmetic that produced it.
 */
function basisFor(topic, uw) {
  const m = uw?.metrics ?? {};
  const o = uw?.optimization ?? {};
  const p = uw?.personal ?? {};
  const primary = uw?.per_bureau?.[uw?.primary_bureau] ?? {};

  switch (topic) {
    case "utilization":
      return {
        utilization_pct: m.utilization_pct,
        unit: "percent",
        target_pct: o.target_util_pct,
        compared_against: {
          over_target_above_pct: ENGINE_THRESHOLDS.utilization_target_pct,
          high_band_from_pct: ENGINE_THRESHOLDS.utilization_high_pct,
          extreme_band_from_pct: ENGINE_THRESHOLDS.utilization_extreme_pct
        },
        primary_bureau: uw?.primary_bureau ?? null
      };

    case "primary_revolving":
      return {
        highest_revolving_limit_usd: p.highest_revolving_limit,
        has_any_revolving: primary.hasAnyRevolving ?? null,
        compared_against: { anchor_limit_usd: ENGINE_THRESHOLDS.anchor_revolving_limit_usd },
        // The reason this can fire even on a strong file. Named at the point of use.
        note: "a line counts toward this limit only if it is open, revolving AND at least 24 months old; " +
              "a line with no account-opened date stored cannot be treated as seasoned, so this figure " +
              "is a floor over whichever lines carry a date"
      };

    case "inquiries":
      return {
        total: m.inquiries?.total ?? null,
        per_bureau: {
          experian: m.inquiries?.ex ?? null,
          equifax: m.inquiries?.eq ?? null,
          transunion: m.inquiries?.tu ?? null
        },
        compared_against: { many_above: ENGINE_THRESHOLDS.inquiries_many }
      };

    case "negatives":
      return {
        negative_accounts: m.negative_accounts,
        compared_against: { many_above: ENGINE_THRESHOLDS.negatives_many },
        primary_bureau: uw?.primary_bureau ?? null
      };

    case "file_buildout":
      return {
        positive_tradelines: primary.positiveTradelinesCount ?? null,
        thin_file: o.thin_file ?? null,
        file_all_negative: o.file_all_negative ?? null,
        highest_revolving_limit_usd: p.highest_revolving_limit,
        highest_installment_amount_usd: p.highest_installment_amount,
        compared_against: { thin_below_positive_tradelines: 3 }
      };

    case "llc":
      return {
        fundable: uw?.fundable ?? null,
        has_llc: null,
        llc_age_months: null,
        note: "fundhub stores no LLC or business-entity field; the engine was given no LLC data " +
              "and applied its own defaults (no LLC, age 0)"
      };

    case "fallback":
      return {
        fundable: uw?.fundable ?? null,
        compared_against: { fundable_min_score: ENGINE_THRESHOLDS.fundable_min_score },
        score: m.score ?? null,
        utilization_pct: m.utilization_pct,
        negative_accounts: m.negative_accounts,
        note: "no other rule fired; this is the engine's closing line"
      };

    default:
      return null;
  }
}

/**
 * annotateSuggestions — engine strings -> strings plus their reasoning.
 *
 * THE STRING IS RETURNED VERBATIM AND IS NEVER REWRITTEN. It is the product.
 * Everything this function adds sits beside it, never inside it.
 *
 * @param {string[]} suggestions  buildSuggestions output
 * @param {object} uw             computeUnderwrite output
 * @param {object} missing        the adapter's missing-field record
 * @returns {Array} [{ text, id, topic, engine, recognised, basis,
 *                     restsOnMissingData, missingFields }]
 */
export function annotateSuggestions(suggestions = [], uw = {}, missing = {}) {
  const missingNames = missingFieldNames(missing);

  return (Array.isArray(suggestions) ? suggestions : []).map((text) => {
    const entry = SUGGESTION_CATALOGUE[text] ?? null;

    if (!entry) {
      // An unrecognised string means the vendored engine changed and this
      // catalogue did not. Say so on the response rather than guessing a topic —
      // a wrong label on credit advice is worse than an admitted gap.
      return {
        text,
        id: null,
        topic: null,
        engine: ENGINES.UNDERWRITE_IQ,
        recognised: false,
        basis: null,
        restsOnMissingData: null,
        missingFields: [],
        note: "this sentence is not in the catalogue — the vendored engine may have changed; " +
              "src/underwrite/fixtures.test.mjs is the check that should have caught it"
      };
    }

    const unmet = entry.dependsOn.filter((f) => missingNames.has(f));
    return {
      text,
      id: entry.id,
      topic: entry.topic,
      engine: ENGINES.UNDERWRITE_IQ,
      recognised: true,
      basis: basisFor(entry.topic, uw),
      // The honest-partial rule. True means at least one number this sentence
      // rests on was never entered, so the sentence is running on the engine's
      // zero-default rather than on a measurement.
      restsOnMissingData: unmet.length > 0,
      missingFields: unmet.flatMap((f) => detailsFor(missing, f))
    };
  });
}

/**
 * buildReport — the whole response body, assembled from parts the caller fetched.
 *
 * @param {object} input
 * @param {object} input.underwrite       computeUnderwrite output
 * @param {string[]} input.suggestions    buildSuggestions output
 * @param {object} input.adapter          toBureaus() output
 * @param {object} [input.fundhubUtilization]  evaluateUtilization() output from
 *        src/alerts/evaluate.mjs. Optional. When present, BOTH engines' readings
 *        of utilization appear in `utilizationVoices`, each stamped with the
 *        engine that produced it.
 */
export function buildReport({ underwrite, suggestions, adapter, fundhubUtilization = null } = {}) {
  const uw = underwrite ?? {};
  const missing = adapter?.missing ?? {};

  // ── The two engines, side by side, each speaking for itself. ──
  //
  // src/alerts/evaluate.mjs keeps its four rules and this integration adds none.
  // But both it and UnderwriteIQ have something to say about utilization, and a
  // screen showing two utilization lines with no attribution is how an owner ends
  // up asking which one is right and getting no answer. So each line names its
  // engine, its units, and what it is measured over.
  //
  // THE UNITS DIFFER AND THAT IS NOT A BUG. UnderwriteIQ works in percent units
  // (30 means 30%); evaluate.mjs works in a decimal fraction (0.30 means 30%).
  // Both are stated on the line rather than silently normalised, because
  // normalising is where a factor of 100 gets lost.
  const utilizationVoices = [
    {
      engine: ENGINES.UNDERWRITE_IQ,
      measure: "utilization_pct",
      value: uw.metrics?.utilization_pct ?? null,
      unit: "percent",
      scope: `primary bureau (${uw.primary_bureau ?? "none"})`,
      partial: adapter?.utilization?.partial ?? null,
      says: uw.optimization?.needs_util_reduction === true
        ? "above the engine's 30% target"
        : uw.optimization?.needs_util_reduction === false
          ? "not above the engine's 30% target"
          : null
    }
  ];

  if (fundhubUtilization) {
    utilizationVoices.push({
      engine: ENGINES.FUNDHUB_ALERTS,
      measure: "utilization",
      value: fundhubUtilization.utilization ?? null,
      unit: "fraction",
      scope: "all open revolving lines",
      partial: fundhubUtilization.partial ?? null,
      // evaluate.mjs's `over` is true | false | null and null means UNKNOWN, not
      // "no". Carried through as-is.
      over: fundhubUtilization.over ?? null,
      threshold: fundhubUtilization.threshold ?? null,
      reason: fundhubUtilization.reason ?? null,
      lines: fundhubUtilization.lines ?? null,
      knownPortion: fundhubUtilization.knownPortion ?? null
    });
  }

  // `lite_banner_funding` has a hardcoded 15000 fallback upstream. If no card
  // funding was computed, that is what this number is, and no screen should print
  // it as an amount anyone qualifies for.
  const bannerIsFallback =
    (uw.lite_banner_funding ?? null) === 15000 &&
    !(uw.per_bureau?.[uw.primary_bureau]?.cardFunding > 0) &&
    !(uw.personal?.card_funding > 0);

  // Data-dependent, same reasoning as the adapter's own client-level "opened"
  // gap (src/underwrite/adapter.mjs): a real open date can now be stored, so
  // this can no longer be asserted true on every response.
  const openedIsMissing = missingFieldNames(missing).has("opened");

  return {
    engine: {
      name: ENGINES.UNDERWRITE_IQ,
      upstreamCommit: null, // filled by the endpoint from engine.mjs's UPSTREAM
      pure: false,
      purityNote: "computeUnderwrite reads the system clock to age tradelines; " +
                  "a line with no stored open date reads as unseasoned"
    },
    underwrite: uw,
    suggestions: annotateSuggestions(suggestions, uw, missing),
    utilizationVoices,
    dataCompleteness: {
      // Which bureaus the engine actually assessed, and which it was not given.
      bureausAssessed: adapter?.available ?? [],
      bureausUnavailable: (adapter?.available
        ? ["experian", "equifax", "transunion"].filter((b) => !adapter.available.includes(b))
        : []),
      missing,
      tradelineGaps: adapter?.tradelineGaps ?? [],
      scoreSource: adapter?.scoreSource ?? null,
      scoreAsOf: adapter?.scoreAsOf ?? null
    },
    caveats: {
      bannerFundingIsFallback: bannerIsFallback,
      bannerFundingNote: bannerIsFallback
        ? "lite_banner_funding is the engine's hardcoded 15000 display floor, not a computed figure " +
          "and not an amount this client is approved for"
        : null,
      fundingFiguresAreFloors: openedIsMissing,
      fundingFiguresNote: openedIsMissing
        ? "at least one tradeline has no account-opened date stored, so it cannot be treated as " +
          "seasoned. Card and loan stacking capacity are computed as a floor over whichever lines " +
          "carry a date, not the client's full file."
        : null
    }
  };
}

export default buildReport;
