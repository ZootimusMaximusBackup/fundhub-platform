// UnderwriteIQ Lite — the adapter. Stored fundhub rows -> the engine's bureau
// shape, plus an honest account of everything it could not fill.
//
// PURE. NO I/O, NO CLOCK, NO DATABASE. The caller fetches the rows and passes
// them in — same contract as src/alerts/evaluate.mjs and src/finance/os-grid.mjs,
// and for the same reason: these mappings decide what a client is told about
// their funding, so they have to be checkable without standing up Postgres.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE PROBLEM THIS FILE EXISTS TO SOLVE
//
// The engine keeps an unknown count as null and never fills it in
// (./vendor/underwriter.cjs:38-43). Every gate it has is written as `=== 0` —
// `neg === 0` decides `fundable` (:212), `lates === 0` decides loan stacking
// (:199-202) — and null fails all of them. So a client whose negatives nobody
// has typed in comes out NOT fundable, with loan funding withheld, exactly like
// a client whose file is genuinely dirty. The engine is right to refuse. What it
// cannot do is say WHY it refused: it is a pure function over the numbers it is
// given, and nothing in those numbers tells it whether a null means "we looked
// and there are none" or "nobody has entered this".
//
// So this file tracks that distinction on OUR side. Every bureau field is either
// FILLED from a real stored value or RECORDED AS MISSING, with the name of the
// thing an owner would have to enter. `./report.mjs` then marks any suggestion
// resting on a missing field, and the endpoint names the field instead of
// printing a confident sentence built on a null.
//
// THE DIRECTION OF THE ERROR IS THE SAFE ONE, and this comment said the opposite
// until 2026-08-19. A gap makes a client's position read WORSE than it is, never
// better — an unknown count never passes for a clean file. So what the missing
// map defends against is not an overstatement. It is the reverse: an operator
// reading "not fundable, $0" off a screen and concluding the client's credit is
// bad, when in fact six numbers were simply never entered.
//
// Absence is never repaired here. Nothing is coalesced to zero, no score is
// inferred from another bureau, no date is estimated. If it is not stored, it is
// missing, and missing is the finding.
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHAT FUNDHUB SIMPLY DOES NOT STORE. Found by reading the schema, not assumed.
// These are gaps in the product, recorded here because they change what the
// engine can honestly say:
//
//   * ACCOUNT OPENED DATE — stored on `tradelines.opened_on` (migration 095) and
//     mapped at ingest by src/tradelines/index.mjs's OPENED_KEYS. This was WRONG
//     here until 2026-08-01: an earlier report concluded no such field existed
//     anywhere, on the strength of this file's own synthetic test fixtures,
//     which never matched the real CRS payload shape (`accountOpenedDate`,
//     confirmed against the vendor's sandbox library). Two bugs, not one — the
//     normalizer's key lists also missed the real lender/limit/balance/ref field
//     names, so real bureau tradelines were being dropped before ingest even
//     reached this column. Both are fixed as of the same change that corrected
//     this comment.
//
//     A row ingested BEFORE the fix still has `opened_on: null` and reads as
//     unseasoned until the client is pulled again — nothing here backfills that,
//     on purpose (see src/tradelines/store.mjs). The engine calls a line
//     "seasoned" at >= 24 months old and seasoning gates EVERY funding figure it
//     produces, so a line with no date still reads unseasoned, still contributes
//     0 to `highestRevolvingLimit`, and `lite_banner_funding` comes back null
//     whenever that leaves no card funding computed — no figure to show, not a
//     placeholder one. There is no hardcoded 15000 display floor any more; it was
//     removed on 2026-08-01 because a placeholder figure is indistinguishable
//     from a computed one at the screen, which is the worse failure. That
//     per-line gap is reported as `opened` in `tradelineGaps`; it is no longer
//     reported unconditionally at the client level, because it is no longer
//     unconditionally true.
//
//   * LLC / ENTITY DATA — a `businesses` row on the file means the client has
//     a company. We set `hasLLC` from that and `llcAgeMonths` from
//     `businesses.age_months` when that number is there. No company on file
//     still records `hasLLC` as missing, so the engine's "no LLC" default is
//     marked as a default rather than a fact.
//
//   * PER-BUREAU IDENTITY (names / addresses / employers) — nowhere, and it does
//     not matter. `normalizeBureau` carries those four arrays through but
//     `computeUnderwrite` never reads them, so an empty array changes no output.
//     Recorded as `informational: true` so nobody chases a gap that moves nothing.
//
// PER-BUREAU vs CLIENT-WIDE. The engine wants three independent bureau readings.
// fundhub holds three things per bureau (the tri-merge scores and the three
// inquiry counts) and everything else exactly once for the client: one set of
// tradelines, one negatives count, one late-payments count. Those client-wide
// values are given to each available bureau and flagged `perBureau: false`, so a
// reader can see that three matching numbers are one number repeated, not three
// bureaus agreeing.

import { fromCents } from "../commissions/money.mjs";
import { financeOsGrid } from "../finance/os-grid.mjs";
import { triMerge } from "../http/client-detail.mjs";
import { isoDay } from "../liabilities/card-stack.mjs";
import { resolveBusinessAges } from "./business-funding.mjs";

export const BUREAUS = Object.freeze(["experian", "equifax", "transunion"]);

/* The three inquiry columns, by bureau. These are the ONLY per-bureau measures
   fundhub carries besides the scores. Names are the live GHL custom fields
   recorded in db/schema/meta/custom-field-map.json. */
const INQUIRY_FIELDS = Object.freeze({
  experian: "crs_inquiries_ex",
  equifax: "crs_inquiries_eq",
  transunion: "crs_inquiries_tu"
});

/* A finite number, or null. Everything else — undefined, "", "null", NaN, a
   negative count — is UNKNOWN. Deliberately does NOT accept a negative: a
   negative inquiry count is a data error, and passing it to an engine that adds
   it into a total would hide the error inside a plausible sum. */
function count(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "null") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/* Integer cents -> a dollars NUMBER, via money.mjs's own converter so cents ->
   dollars is read one way in this repo. THE ONLY CENTS-TO-DOLLARS CONVERSION IN
   THIS INTEGRATION — the engine works in dollars (./engine.mjs, note 3) and
   nothing downstream converts again. Returns null for unknown; never 0. */
function dollars(cents) {
  if (cents === null || cents === undefined || cents === "") return null;
  const n = Number(cents);
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(fromCents(Math.round(n)));
}

/* fundhub `kind` -> the engine's `type`.
 *
 * revolving   -> "revolving"    the engine's card-stacking subject
 * installment -> "installment"  one of its three installment types
 * loc         -> "loc"          PASSED THROUGH UNTRANSLATED, ON PURPOSE.
 *
 * A line of credit draws like a card, which is why it is tempting to send it as
 * "revolving". Refused: the engine uses the highest OPEN SEASONED REVOLVING LIMIT
 * to decide whether a client can card-stack and how much they could raise. A LOC
 * is not a credit card and counting one as the client's anchor card would invent
 * stacking capacity that no lender is going to honour. Sent as "loc", the engine
 * does not recognise the type, so the line still counts toward file depth
 * (positiveTradelinesCount) but contributes nothing to card or loan stacking.
 * That is the conservative direction and it is the one that cannot overstate. */
function engineType(kind) {
  if (kind === "revolving") return "revolving";
  if (kind === "installment") return "installment";
  return kind ?? null;
}

/* Status, as the engine reads it: it lowercases and substring-matches for "open"
   and for the derogatory words. Derogatory standing comes from the card's CURRENT
   liability position (083 payment_status), which is the only place fundhub
   records charge-offs and collections.

   `late_30/60/90/120` deliberately do NOT become a derog status. The engine's
   derog list is charge-offs, collections and repossessions — accounts that make a
   file "all negative". A 30-day late is a late payment, it is counted as one in
   late_payment_events, and promoting it to a derog here would be this repo
   inventing a rule the engine does not have. */
function engineStatus(tradeline, liability) {
  const closed = Boolean(tradeline?.closed_at);
  const status = liability?.payment_status ?? null;
  if (status === "charge_off") return closed ? "closed chargeoff" : "open chargeoff";
  if (status === "collection") return closed ? "closed collection" : "open collection";
  return closed ? "closed" : "open";
}

/**
 * toEngineTradelines — fundhub tradeline rows (+ their current liability
 * positions) -> the engine's tradeline array, and a per-line note of what is
 * missing.
 *
 * @param {Array} tradelines  `tradelines` rows (054)
 * @param {Array} liabilities `card_liabilities` rows (083), matched by
 *        tradeline_id. Optional — absent means no derog standing is known, which
 *        is reported, not assumed clean.
 */
export function toEngineTradelines(tradelines = [], liabilities = []) {
  const byTradeline = new Map();
  for (const l of Array.isArray(liabilities) ? liabilities : []) {
    if (l?.tradeline_id) byTradeline.set(String(l.tradeline_id), l);
  }

  const rows = Array.isArray(tradelines) ? tradelines : [];
  const lines = [];
  const gaps = [];

  for (const t of rows) {
    if (!t) continue;
    const liability = byTradeline.get(String(t.id)) ?? null;
    const limit = dollars(t.credit_limit_cents);
    const balance = dollars(t.balance_cents);
    // tradelines.opened_on is a `date` column; node-postgres parses a non-null
    // one into a JS Date, and the engine's monthsSince() only accepts a string
    // (./vendor/underwriter.cjs). isoDay handles both a Date and a string and
    // returns null for either a null column or an unparseable value — never a
    // guessed date. See src/tradelines/index.mjs for where this is populated
    // (readOpenedOn, at ingest) and store.mjs for why a re-pull cannot erase it.
    const openedOn = isoDay(t.opened_on);

    lines.push({
      type: engineType(t.kind),
      status: engineStatus(t, liability),
      limit,
      balance,
      // null makes monthsSince() return null, which makes the line unseasoned —
      // the conservative reading, withholding funding capacity rather than
      // inventing it, for any line whose open date fundhub does not have.
      opened: openedOn
    });

    const missing = [];
    if (limit === null) missing.push("credit_limit_cents");
    if (balance === null) missing.push("balance_cents");
    if (liability === null) missing.push("payment_status");
    // Worth naming whenever it's true — it is the field that decides whether
    // this specific line can support any funding at all. No longer unconditional
    // now that real open dates flow through; see the header.
    if (openedOn === null) missing.push("opened");

    gaps.push({
      tradelineId: t.id ?? null,
      lender: t.lender ?? null,
      kind: t.kind ?? null,
      // A `loc` reached the engine as an unrecognised type on purpose; say so,
      // because a reader comparing line counts to stacking capacity will
      // otherwise think a line was dropped.
      passedThroughUntyped: t.kind === "loc",
      missing
    });
  }

  return { lines, gaps };
}

/**
 * clientUtilizationPct — the client's revolving utilization, in PERCENT UNITS.
 *
 * Reuses src/finance/os-grid.mjs rather than summing limits and balances again
 * here. That module already decides which lines are drawable, refuses to divide
 * by a zero limit, and reports how many lines it could not read — three rules
 * that would drift the moment there were two copies of them. Its utilization row
 * is a FRACTION; the engine wants PERCENT UNITS (./engine.mjs, note 4), so the
 * multiply by 100 happens here, once.
 *
 * Returns { pct, partial, basis }. `pct` is null when the grid could not compute
 * one — never 0, which would read as a client using none of their credit.
 */
export function clientUtilizationPct(tradelines = []) {
  const grid = financeOsGrid(Array.isArray(tradelines) ? tradelines : []);
  const row = grid.rows.find((r) => r.key === "utilization");
  const fraction = row?.value ?? null;
  return {
    pct: fraction === null ? null : fraction * 100,
    // The grid counted lines it could not read. The number is a floor built on
    // the readable subset, not the client's utilization.
    partial: Boolean(row?.basis?.partial),
    basis: row?.basis ?? null
  };
}

/**
 * toBureaus — everything above, assembled into the engine's input.
 *
 * @param {object} input
 * @param {Array}  [input.tradelines]   `tradelines` rows (054)
 * @param {Array}  [input.liabilities]  `card_liabilities` rows (083)
 * @param {Array}  [input.crsResults]   `crs_results` rows, newest-first or not —
 *                 triMerge picks the most recent one carrying scores
 * @param {object} [input.customFields] `clients.custom_fields` jsonb
 * @param {Array}  [input.businesses]   `businesses` rows (age_months per company)
 *
 * @returns {object} {
 *   bureaus,            // { experian, equifax, transunion } for computeUnderwrite
 *   businessAgeMonths,  // number | null — first known age (engine still takes one)
 *   businessAges,       // number|null[] — one age per saved company
 *   missing,            // { <bureau>: [ {field, reason, ...} ], client: [...] }
 *   available,          // string[] — which bureaus carry a score
 *   utilization,        // { pct, partial, basis }
 *   tradelineGaps       // per-line missing-field notes
 * }
 *
 * A BUREAU IS "AVAILABLE" ONLY IF IT HAS A SCORE. normalizeBureau would mark any
 * object we hand it as available, including one that is entirely nulls — and an
 * available bureau with no score becomes score 0 inside the engine, which is a
 * client with a 0 credit score sitting in the output. So a bureau with no
 * tri-merge score is passed as `undefined` and the engine correctly reports it
 * unavailable. Failing to the "we don't have this bureau" side is right: it is
 * true, and it is the side that cannot overstate.
 */
export function toBureaus({ tradelines = [], liabilities = [], crsResults = [], customFields = {}, businesses = [] } = {}) {
  const cf = customFields && typeof customFields === "object" ? customFields : {};
  const scores = triMerge(Array.isArray(crsResults) ? crsResults : []);
  const { lines, gaps } = toEngineTradelines(tradelines, liabilities);
  const utilization = clientUtilizationPct(tradelines);

  // Client-wide measures. One value each, shared across the bureaus that exist.
  const negatives = count(cf.crs_negative_items_count);
  const lates = count(cf.crs_late_payments_count);

  const bureaus = {};
  const missing = { client: [] };
  const available = [];

  for (const key of BUREAUS) {
    const score = count(scores[key]);
    const inquiries = count(cf[INQUIRY_FIELDS[key]]);
    const gapsForBureau = [];

    if (score === null) {
      // No score => the bureau is not supplied at all. Say why, and stop: the
      // other fields are moot for a bureau the engine will not read.
      missing[key] = [{
        field: "score",
        source: "crs_results.result.scores",
        reason: "no stored score for this bureau",
        effect: "bureau reported unavailable; it contributes nothing to the assessment"
      }];
      continue;
    }

    available.push(key);

    if (inquiries === null) {
      gapsForBureau.push({
        field: "inquiries",
        source: `clients.custom_fields.${INQUIRY_FIELDS[key]}`,
        reason: "not entered",
        // NOT "counts 0". An AVAILABLE bureau with no count stays null
        // (./vendor/underwriter.cjs:54-58), and the total refuses to add up
        // while any one slot is null (:60-63) — so one blank field blanks the
        // whole figure, not just this bureau's share of it.
        effect: "this bureau's inquiry count is unknown, and one unknown bureau leaves the " +
                "whole inquiry total unknown — no inquiry figure can be shown"
      });
    }
    if (utilization.pct === null) {
      gapsForBureau.push({
        field: "utilization_pct",
        source: "tradelines.credit_limit_cents / balance_cents",
        reason: utilization.basis?.counted === 0
          ? "no line has both a limit and a balance stored"
          : "utilization could not be computed",
        effect: "no utilization advice can be given"
      });
    } else if (utilization.partial) {
      gapsForBureau.push({
        field: "utilization_pct",
        source: "tradelines.credit_limit_cents / balance_cents",
        reason: `computed from ${utilization.basis.counted} of ${utilization.basis.lines} lines; ` +
                `${utilization.basis.unknown} could not be read`,
        effect: "utilization is a floor over the readable lines, not the client's true figure",
        partial: true
      });
    }
    if (negatives === null) {
      gapsForBureau.push({
        field: "negatives",
        source: "clients.custom_fields.crs_negative_items_count",
        reason: "not entered",
        // The consequential one. Worth spelling out at the point of loss.
        // NOT "counts 0". The engine keeps it null (./vendor/underwriter.cjs:144)
        // and `fundable` requires `neg === 0`, which null fails (:212) — so a
        // blank field and a dirty file produce the same answer on the screen.
        effect: "the negatives count stays unknown, and `fundable` requires a measured zero — " +
                "so this client reads NOT fundable until someone enters the count, even if " +
                "their file is spotless"
      });
    }
    if (lates === null) {
      gapsForBureau.push({
        field: "late_payment_events",
        source: "clients.custom_fields.crs_late_payments_count",
        reason: "not entered",
        // NOT "counts 0". Null again (./vendor/underwriter.cjs:145), and loan
        // stacking needs `lates === 0` (:199-202), so the funding is withheld
        // rather than granted.
        effect: "the late-payment count stays unknown, and loan stacking needs a measured zero — " +
                "so every dollar of loan funding is withheld until someone enters it"
      });
    }
    if (lines.length === 0) {
      gapsForBureau.push({
        field: "tradelines",
        source: "tradelines rows",
        reason: "no lines stored for this client",
        effect: "file reads as thin and no funding capacity can be computed"
      });
    }

    missing[key] = gapsForBureau;

    bureaus[key] = {
      score,
      // PERCENT UNITS. Converted once, in clientUtilizationPct.
      utilization_pct: utilization.pct,
      inquiries,
      negatives,
      late_payment_events: lates,
      // Not stored, and not read by computeUnderwrite either — see the header.
      names: [],
      addresses: [],
      employers: [],
      tradelines: lines
    };
  }

  // Client-wide gaps: things that are not any one bureau's business.
  if (negatives === null || lates === null) {
    missing.client.push({
      field: "per_bureau_attribution",
      source: "clients.custom_fields",
      reason: "negatives and late payments are stored once for the client, not per bureau",
      effect: "the same figure is reported under each available bureau; matching values are one number repeated",
      perBureau: false,
      informational: true
    });
  }
  const hasLLC = Array.isArray(businesses) && businesses.length > 0;
  let llcAgeMonths = null;
  if (hasLLC) {
    for (const row of businesses) {
      const age = Number(row.age_months);
      if (Number.isFinite(age) && age >= 0) {
        llcAgeMonths = llcAgeMonths == null ? age : Math.max(llcAgeMonths, age);
      }
    }
  } else {
    missing.client.push({
      field: "hasLLC",
      source: "businesses",
      reason: "no company stored for this client",
      effect: "the engine's LLC suggestion is produced from its default of 'no LLC', not from this client's record"
    });
  }
  // Data-dependent, not blanket: a line ingested since the 2026-08-01 fix (or a
  // manual entry the client dated) can carry a real opened_on. Report the gap
  // only when it is actually true for at least one line — see the header for
  // why this is no longer an unconditional push.
  const openedGapCount = gaps.filter((g) => g.missing.includes("opened")).length;
  if (openedGapCount > 0) {
    missing.client.push({
      field: "opened",
      source: "tradelines.opened_on",
      reason: openedGapCount === lines.length
        ? "no account-opened date stored for any line — ingested before the mapping fix, " +
          "or a manual entry with no date given"
        : `no account-opened date stored for ${openedGapCount} of ${lines.length} lines`,
      effect: "those lines read unseasoned, so they contribute nothing to card or loan stacking " +
              "and the client's true stacking capacity may be higher than what is shown"
    });
  }
  if (Array.isArray(crsResults) && crsResults.length === 0) {
    missing.client.push({
      field: "crs_results",
      source: "crs_results rows",
      reason: "no credit pull stored for this client",
      effect: "no bureau has a score, so the engine has nothing to assess"
    });
  }

  const fallbackAge = count(cf.business_age_months);
  const businessAges = resolveBusinessAges({ businesses, fallbackAgeMonths: fallbackAge });
  const businessAgeMonths = businessAges.find((age) => age != null) ?? null;
  if (businessAgeMonths === null) {
    missing.client.push({
      field: "business_age_months",
      source: "clients.custom_fields.business_age_months",
      reason: "not entered",
      effect: "no business funding figure can be produced"
    });
  }

  return {
    bureaus,
    businessAgeMonths,
    businessAges,
    /* COMPUTED ABOVE AND, UNTIL NOW, THROWN AWAY. Both were worked out from
       `businesses` and then never put on the returned object, so every caller
       reading out.hasLLC got `undefined` and out.llcAgeMonths got `undefined`
       rather than null. The header of this file has always said it sets them.
       `undefined` is the worst of the three answers here: it is falsy, so
       "no LLC" kept working by accident, while llcAgeMonths broke the rule
       that NULL MEANS UNKNOWN AND MUST SURVIVE. */
    hasLLC,
    llcAgeMonths,
    missing,
    available,
    utilization,
    tradelineGaps: gaps,
    scoreSource: scores.source ?? null,
    scoreAsOf: scores.asOf ?? null
  };
}

export default toBureaus;
