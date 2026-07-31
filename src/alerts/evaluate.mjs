// Alerts — the rules, as pure functions.
//
// WHAT THIS MODULE IS. Four decisions the business makes about a client's credit
// data: is utilization over the line, where does a score sit, is there a case for
// a better card, and what did the month look like. They live here, together,
// as functions that take plain values and return plain values.
//
// PURE. NO I/O, NO CLOCK, NO RANDOMNESS, NO DATABASE. Same contract as
// src/commissions/money.mjs and src/calculators/deal-funding.mjs, and for the
// same reason: these are the rules of the business, so they have to be checkable
// without standing up Postgres. If it needs the current time, the caller passes
// the time. If it needs rows, the caller passes the rows. The db access for
// alerts lives outside this file, exactly as src/tradelines/store.mjs sits
// outside src/tradelines/index.mjs.
//
// ═══════════════════════════════════════════════════════════════════════════════
// NULL MEANS UNKNOWN, AND UNKNOWN IS NOT FALSE.
//
// This is the single rule the whole file is built around, and it is the one most
// likely to rot, because every one of these functions returns something that
// reads fine when it is wrong. A missing credit limit that quietly becomes 0
// gives you 0% utilization, which looks healthy. A missing score that quietly
// becomes "unbanded" gives you a client who never trips a gate. A missing
// threshold that quietly falls back to a default gives you a rule firing on a
// number nobody approved.
//
// So: unknown inputs produce `known: false` and a `reason`, and every derived
// field on that result is null — including the booleans. `over` is
// true | false | null, never just true | false. A caller that treats
// `if (!result.over)` as "fine" has a bug, and the shape is designed so that bug
// is visible in code review.
//
// The precedent is src/tradelines/index.mjs, which refuses to read an ambiguous
// APR rather than clamp it, and src/config/survey-qualification.mjs, which
// routes an absent survey answer to MANUAL_REVIEW rather than passing or failing
// it. Same posture, applied to credit numbers.
// ═══════════════════════════════════════════════════════════════════════════════
//
// WHERE THE NUMBERS COME FROM. Stated plainly, because two of them have a source
// in this repo and none of them has a source outside it:
//
//   * 30% utilization — INHERITED, NOT SOURCED. It is the default value of
//     `utilizationThreshold` in src/calculators/deal-funding.mjs, where the
//     comment calls it "per-org configurable". That file cites nothing. It is an
//     operating convention this business already runs on, and it is reused here
//     so there is one number rather than two. It is NOT a bureau-published
//     figure and this module does not claim it is. Real configuration is a
//     `upsell_triggers.threshold_bps` row (079), which ships unset.
//
//   * The score bands — REUSED FROM THIS REPO'S OWN SOURCE OF TRUTH. They are
//     the option set of the self-reported FICO survey question, recorded in
//     src/config/survey-qualification.mjs as coming from the 05/30 doc, and the
//     band edges below are parsed out of those labels rather than retyped. Which
//     two bands clear the funding-call gate is that same doc's rule (line 38),
//     read through PASSING_FICO_BANDS. Nothing here invents a band.
//
//   * 300..850 — the published range of the FICO and VantageScore 3.0/4.0
//     scales. Used only to reject impossible input, never to band it.
//
//   * severity levels, and the adjectives a screen might want ("good",
//     "excellent") — NOT HERE. This module returns band labels and numbers. It
//     does not name a score good or bad, because the moment a judgement about
//     somebody's credit is written down it is one screen away from being shown
//     to them, and that is a claim about a credit outcome in a regulated
//     consumer-finance product. Compliance sign-off, not a default parameter.

import { toCents } from "../tradelines/index.mjs";
import { roundHalfUp } from "../commissions/money.mjs";
import { FICO_BANDS, PASSING_FICO_BANDS } from "../config/survey-qualification.mjs";

/* ─────────────────────────── thresholds ─────────────────────────── */

/**
 * The utilization threshold as a decimal FRACTION: 0.30 is 30%.
 *
 * Fraction, not percent units, deliberately. src/commissions/money.mjs uses
 * percent units (10 means 10%) for commission rates, and calcFunding uses a
 * fraction (0.30) for this exact quantity. Two conventions already exist in the
 * repo; the tie-breaker is that this value describes the SAME thing calcFunding's
 * `utilizationThreshold` describes, and having 30 mean one thing here and 0.30
 * mean it there is how you end up with a rule that fires a hundred times too
 * often. Matched to the neighbour, not to the money module.
 *
 * src/alerts/evaluate.test.mjs asserts this equals the value calcFunding
 * actually applies, so the two cannot drift apart silently.
 */
export const DEFAULT_UTILIZATION_THRESHOLD = 0.30;

/**
 * upsell_triggers.threshold_bps (integer basis points) -> decimal fraction.
 * THE ONLY PLACE THAT CONVERSION HAPPENS. 3000 -> 0.30.
 *
 * Returns null for null, for a non-integer, and for anything outside the
 * column's own 0..100000 CHECK — all of which mean "no usable threshold is
 * configured", which must refuse to fire rather than fall back to a default.
 * A silent fallback here would defeat the entire point of 079 shipping unset.
 */
export function thresholdFromBps(bps) {
  if (bps === null || bps === undefined || bps === "") return null;
  const n = typeof bps === "number" ? bps : Number(String(bps).trim());
  if (!Number.isInteger(n) || n < 0 || n > 100_000) return null;
  return n / 10_000;
}

/* ─────────────────────────── reading a line ─────────────────────────── */

/* Two shapes already exist in this repo for a credit line and this module reads
   both rather than inventing a third:

     * a `tradelines` row (054): credit_limit_cents / balance_cents, integer cents;
     * a calcFunding card (src/calculators/deal-funding.mjs, produced by
       toCalculatorCards): creditLimit / currentBalance, dollars.

   Cents keys win when both are present, because they are lossless.

   ⚠️ A KNOWN LOSS ON THE CALCULATOR SHAPE. toCalculatorCards() maps
   `currentBalance: fromCents(r.balance_cents) ?? 0` — a tradeline with an
   UNKNOWN balance arrives at the calculator as a balance of zero. By the time a
   card reaches this function that distinction is already gone and cannot be
   recovered, so a calculator card with balance 0 reads as a real zero balance
   and its utilization reads as 0%. Feed these functions `tradelines` ROWS where
   the answer matters. Recorded as a finding rather than worked around, because
   the fix belongs in toCalculatorCards and that is not this unit's file. */
const LIMIT_CENTS_KEYS = ["limitCents", "credit_limit_cents", "creditLimitCents"];
const BALANCE_CENTS_KEYS = ["balanceCents", "balance_cents"];

function firstPresent(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

/* A non-negative integer count of cents, or null for anything we cannot read.
   Negative is refused rather than absolute-valued: the column CHECKs forbid it
   and src/tradelines/index.mjs's toCents already refuses it, so a negative here
   is a bug upstream, and turning it into a number would hide it. */
function readCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * readLine — one credit line in either supported shape -> a common internal
 * reading. Exported because the alert writer needs the same reading the
 * evaluator used, and re-deriving it there would be the second answer.
 */
export function readLine(line) {
  if (!line || typeof line !== "object") {
    return { id: null, lender: null, kind: null, closed: false, limitCents: null, balanceCents: null, apr: null };
  }
  let limitCents = readCents(firstPresent(line, LIMIT_CENTS_KEYS));
  let balanceCents = readCents(firstPresent(line, BALANCE_CENTS_KEYS));
  // Dollar shape only when the cents shape said nothing. toCents() is
  // src/tradelines/index.mjs's, so dollars->cents is read one way in this repo.
  if (limitCents === null) limitCents = toCents(firstPresent(line, ["creditLimit"]));
  if (balanceCents === null) balanceCents = toCents(firstPresent(line, ["currentBalance"]));

  const aprRaw = line.apr;
  const apr = aprRaw === null || aprRaw === undefined || aprRaw === "" ? null : Number(aprRaw);

  return {
    id: line.id ?? null,
    lender: line.lender ?? null,
    kind: line.kind ?? null,
    // closed_at is the tradelines column; closedAt for a camelCase caller.
    closed: Boolean(line.closed_at ?? line.closedAt ?? false),
    limitCents,
    balanceCents,
    apr: Number.isFinite(apr) && apr >= 0 ? apr : null
  };
}

/* Threshold reading, shared by every function that takes one. `undefined` means
   "the caller did not say" and gets the default; an explicit null means "the
   configuration is unset" and must NOT get the default. The difference matters:
   079 ships every rule with threshold_bps NULL on purpose. */
function readThreshold(value) {
  if (value === undefined) return { threshold: DEFAULT_UTILIZATION_THRESHOLD, reason: null };
  if (value === null) return { threshold: null, reason: "unknown_threshold" };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { threshold: null, reason: "invalid_threshold" };
  return { threshold: n, reason: null };
}

/* Utilization rounded to 4dp — 0.0001 is one hundredth of a percentage point.
   calcFunding rounds this quantity to 2dp, which turns 35.67% into 36%; fine for
   a headline on a screen, not fine for a value a threshold is compared against
   or that gets written into an alert's `detail` as the reason it fired. The
   COMPARISON does not use this number at all — see below. */
const round4 = (n) => (n === null ? null : Math.round(n * 1e4) / 1e4);
const round2 = (n) => (n === null ? null : Math.round(n * 1e2) / 1e2);

/* Is balance/limit strictly ABOVE threshold, decided in integers.
 *
 * WHY NOT `balance / limit > threshold`. 3000/10000 is 0.29999999999999998889 in
 * a double, so a client sitting exactly on a 30% line lands on whichever side of
 * it the floating-point error falls — and a threshold alert that fires or does
 * not fire depending on rounding noise is worse than no alert. Cross-multiplying
 * through basis points keeps both sides integers and the boundary exact.
 *
 * STRICTLY ABOVE, so exactly-at-threshold does NOT fire. That matches
 * calcFunding's guardrail, which breaches on `after > utilizationThreshold`. One
 * number, one comparison, one meaning.
 *
 * Magnitudes: money.mjs caps at 1e11 cents ($1bn); 1e11 * 1e4 = 1e15, inside the
 * 2^53 (~9.0e15) range where integer arithmetic in a double is still exact.
 */
function isOver(balanceCents, limitCents, threshold) {
  const thresholdBps = Math.round(threshold * 10_000);
  return balanceCents * 10_000 > thresholdBps * limitCents;
}

/* ─────────────────────────── 1. utilization ─────────────────────────── */

function unknownUtilization(threshold, reason, extra = {}) {
  return {
    known: false,
    reason,
    threshold,
    limitCents: null,
    balanceCents: null,
    headroomCents: null,
    utilization: null,
    utilizationPct: null,
    over: null,
    ...extra
  };
}

function evaluateOneLine(line, threshold, thresholdReason) {
  const l = readLine(line);
  if (thresholdReason) {
    return { ...unknownUtilization(threshold, thresholdReason), limitCents: l.limitCents, balanceCents: l.balanceCents, lender: l.lender, id: l.id };
  }
  // A missing limit and a missing balance are DIFFERENT unknowns and are named
  // differently, because the fix is different: one is a bureau field the pull
  // did not carry, the other is a card nobody has updated.
  if (l.limitCents === null) {
    return { ...unknownUtilization(threshold, "unknown_limit"), balanceCents: l.balanceCents, lender: l.lender, id: l.id };
  }
  if (l.balanceCents === null) {
    return { ...unknownUtilization(threshold, "unknown_balance"), limitCents: l.limitCents, lender: l.lender, id: l.id };
  }
  // A zero limit is not zero utilization, it is a division by zero. A card with a
  // $0 limit and a balance on it is a data error; reporting it as 0% used would
  // launder that error into a clean-looking number. calcFunding takes the same
  // line — limit 0 makes its `before`/`after` null rather than 0.
  if (l.limitCents === 0) {
    return { ...unknownUtilization(threshold, "zero_limit"), limitCents: 0, balanceCents: l.balanceCents, lender: l.lender, id: l.id };
  }

  const utilization = l.balanceCents / l.limitCents;
  return {
    known: true,
    reason: null,
    threshold,
    id: l.id,
    lender: l.lender,
    limitCents: l.limitCents,
    balanceCents: l.balanceCents,
    // Headroom floors at zero: an over-limit card has no room, not negative room.
    // Same treatment as calcFunding's headroom().
    headroomCents: Math.max(0, l.limitCents - l.balanceCents),
    utilization: round4(utilization),
    utilizationPct: round2(utilization * 100),
    over: isOver(l.balanceCents, l.limitCents, threshold)
  };
}

/**
 * evaluateUtilization — credit utilization (balance ÷ limit) against a threshold.
 *
 * Takes either ONE line or an ARRAY of lines. One concept, one function: a
 * separate evaluateAggregateUtilization would be the same rule written twice.
 *
 * @param {object|Array} input  a `tradelines` row / calcFunding card, or a list
 * @param {object} [opts]
 * @param {number|null} [opts.threshold]  decimal fraction (0.30 = 30%). Omit for
 *        the default; pass null explicitly for "configured but unset", which
 *        yields an unknown result rather than the default.
 * @param {boolean} [opts.excludeNonRevolving=true]  array input only. Closed
 *        lines and installment loans are dropped from the aggregate — you cannot
 *        revolve on an auto loan and a closed card has no limit in play. Same two
 *        exclusions toCalculatorCards() makes, and for the same reasons. They are
 *        COUNTED and reported, never silently dropped.
 * @returns {object} single: { known, reason, utilization, utilizationPct, over,
 *          headroomCents, limitCents, balanceCents, threshold }
 *          array adds: { lines, partial, perLine, knownPortion }
 *          `over` is true | false | null. null means UNKNOWN, not "no".
 */
export function evaluateUtilization(input, opts = {}) {
  const { threshold, reason: thresholdReason } = readThreshold(opts.threshold);

  if (!Array.isArray(input)) return evaluateOneLine(input, threshold, thresholdReason);

  const excludeNonRevolving = opts.excludeNonRevolving !== false;
  const read = input.map(readLine);

  const counted = [];
  let excludedClosed = 0;
  let excludedInstallment = 0;
  for (const l of read) {
    if (excludeNonRevolving && l.closed) { excludedClosed += 1; continue; }
    if (excludeNonRevolving && l.kind === "installment") { excludedInstallment += 1; continue; }
    counted.push(l);
  }

  const perLine = counted.map((l) => evaluateOneLine(l, threshold, thresholdReason));
  const knownLines = perLine.filter((r) => r.known);
  const unknownLines = perLine.length - knownLines.length;
  const lines = {
    total: read.length,
    counted: counted.length,
    known: knownLines.length,
    unknown: unknownLines,
    excludedClosed,
    excludedInstallment
  };

  if (thresholdReason) return { ...unknownUtilization(threshold, thresholdReason), lines, partial: null, perLine, knownPortion: null };
  if (knownLines.length === 0) return { ...unknownUtilization(threshold, "no_known_lines"), lines, partial: null, perLine, knownPortion: null };

  const balanceCents = knownLines.reduce((s, r) => s + r.balanceCents, 0);
  const limitCents = knownLines.reduce((s, r) => s + r.limitCents, 0);
  const partial = unknownLines > 0;

  // Every known line having a zero limit is the aggregate version of zero_limit.
  if (limitCents === 0) {
    return { ...unknownUtilization(threshold, "zero_limit"), limitCents: 0, balanceCents, lines, partial, perLine, knownPortion: null };
  }

  const utilization = balanceCents / limitCents;
  const overKnownPortion = isOver(balanceCents, limitCents, threshold);

  // ⚠️ THE PARTIAL RULE, AND WHY `over` IS null RATHER THAN THE ANSWER FOR THE
  // PART WE CAN SEE. An unknown line carries BOTH an unknown balance and an
  // unknown limit. Adding it can move aggregate utilization in either direction:
  // a card with a big unused limit drags the total down, a maxed one drags it up.
  // So when any line is unknown, the aggregate answer is genuinely unknown, and
  // saying "over" on the visible 40% of the portfolio would be a guess dressed as
  // a measurement. The measurable part is still reported, under a name that
  // cannot be mistaken for the whole: `knownPortion`.
  return {
    known: true,
    reason: partial ? "partial_data" : null,
    threshold,
    limitCents,
    balanceCents,
    headroomCents: Math.max(0, limitCents - balanceCents),
    utilization: partial ? null : round4(utilization),
    utilizationPct: partial ? null : round2(utilization * 100),
    over: partial ? null : overKnownPortion,
    partial,
    lines,
    perLine,
    knownPortion: {
      utilization: round4(utilization),
      utilizationPct: round2(utilization * 100),
      over: overKnownPortion,
      limitCents,
      balanceCents
    }
  };
}

/* ─────────────────────────── 2. score ─────────────────────────── */

/* The bands, PARSED OUT OF src/config/survey-qualification.mjs's FICO_BANDS
   rather than retyped. That constant is the option set of the self-reported FICO
   question and its provenance (the 05/30 source-of-truth doc) is recorded there.
   Parsing rather than copying means there is exactly one place the edges live:
   change the survey options and these bands follow, instead of two lists that
   agree until somebody edits one.

   "Not sure" is in FICO_BANDS and is skipped here — it is a survey answer, not a
   range of numbers. */
export const SCORE_BANDS = FICO_BANDS.map((label) => {
  const openEnded = /^(\d+)\+$/.exec(label);
  if (openEnded) return { label, min: Number(openEnded[1]), max: null };
  const closed = /^(\d+)-(\d+)$/.exec(label);
  if (closed) return { label, min: Number(closed[1]), max: Number(closed[2]) };
  return null;
}).filter(Boolean);

/* The published range of the FICO and VantageScore 3.0/4.0 scales. Used ONLY to
   reject impossible input — a 1200 is a data error, and banding it would be an
   invention. Older VantageScore 1.0/2.0 ran 501-990; nothing in this repo is
   configured for that scale, and if one ever arrives this constant is where it
   gets handled rather than silently mis-banded. */
export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

/**
 * evaluateScore — a credit score against this repo's banding.
 *
 * DOES NOT JUDGE. Returns which band the number falls in and whether it clears
 * the funding-call gate that src/config/survey-qualification.mjs already defines.
 * It does not return "good", "fair", "excellent" or any other adjective. Those
 * are claims about a person's credit, and in a regulated consumer-finance product
 * a claim needs a human to sign it off, not a default parameter.
 *
 * @param {number|string|null} score
 * @returns {object} { known, reason, score, band, bandIndex, belowLowestNamedBand,
 *                     meetsFundingCallGate }
 *   known=false  -> band, bandIndex and meetsFundingCallGate are ALL null.
 *   band=null with known=true means a real score below the lowest NAMED band
 *   (300..499). That is not an unknown score — the gate answer is still false.
 */
export function evaluateScore(score, opts = {}) {
  const bands = opts.bands ?? SCORE_BANDS;
  const unknown = (reason) => ({
    known: false,
    reason,
    score: null,
    band: null,
    bandIndex: null,
    belowLowestNamedBand: null,
    meetsFundingCallGate: null
  });

  if (score === null || score === undefined || score === "") return unknown("unknown_score");
  const n = typeof score === "number" ? score : Number(String(score).trim());
  if (!Number.isFinite(n)) return unknown("unknown_score");
  // Credit scores are whole numbers. A 712.4 is a computation that went wrong
  // somewhere upstream, and rounding it here would hide that.
  if (!Number.isInteger(n)) return unknown("non_integer_score");
  if (n < SCORE_MIN || n > SCORE_MAX) return unknown("out_of_range");

  const bandIndex = bands.findIndex((b) => n >= b.min && (b.max === null || n <= b.max));
  const band = bandIndex === -1 ? null : bands[bandIndex].label;

  return {
    known: true,
    reason: band === null ? "below_lowest_named_band" : null,
    score: n,
    band,
    bandIndex: bandIndex === -1 ? null : bandIndex,
    belowLowestNamedBand: band === null,
    // The gate is the 05/30 doc's rule (only 700-749 and 750+ clear it), read
    // through the existing constant. A score below every named band definitively
    // does not clear it — unnamed is not the same as unknown.
    meetsFundingCallGate: band === null ? false : PASSING_FICO_BANDS.includes(band)
  };
}

/* ─────────────────────────── 3. card upgrade ─────────────────────────── */

/** Reason codes suggestCardUpgrade can return. Stable strings — an alerts row's
 *  `detail` stores them, so renaming one is a data migration. */
export const UPGRADE_REASONS = {
  AGGREGATE_UTILIZATION_OVER_THRESHOLD: "AGGREGATE_UTILIZATION_OVER_THRESHOLD",
  PER_CARD_UTILIZATION_OVER_THRESHOLD: "PER_CARD_UTILIZATION_OVER_THRESHOLD",
  HIGH_APR_BALANCE: "HIGH_APR_BALANCE",
  LOW_HEADROOM: "LOW_HEADROOM"
};

/**
 * suggestCardUpgrade — given a client's credit lines, is there a case for a
 * better card?
 *
 * FOUR CASES, AND ALL FOUR ARE READ OFF DATA THIS REPO ALREADY HOLDS. None of
 * them requires knowing what cards exist in the market, what the client would be
 * approved for, or what a bureau would do to their score. Those are the things
 * this function deliberately does not pretend to know:
 *
 *   AGGREGATE_UTILIZATION_OVER_THRESHOLD — total balance ÷ total limit is over
 *       the line. More limit is the only lever besides paying it down.
 *   PER_CARD_UTILIZATION_OVER_THRESHOLD — one card is over while the total is
 *       not. Room exists, it is on the wrong card.
 *   HIGH_APR_BALANCE — a balance is sitting on a card priced above the client's
 *       OWN cheapest open card. Purely relative: it compares the client to
 *       themselves, so it makes no claim about the market. The saving figure is
 *       one year of the rate difference on that balance, in integer cents.
 *   LOW_HEADROOM — only when the caller passes `targetAmountCents`. There is no
 *       default target, because a target nobody stated would be invented.
 *
 * ⚠️ NOT A RECOMMENDATION TO A CONSUMER. The output names an internal case for a
 * conversation. Turning any of it into a sentence shown to a client — especially
 * anything implying their score will move — is a claim about a credit outcome and
 * needs compliance sign-off first.
 *
 * @param {object|Array} input  { tradelines: [...] } or a bare array of lines
 * @param {object} [opts] { threshold, targetAmountCents }
 * @returns {object} { suggest, reasons, utilization, bestApr, estimatedAnnualSavingCents, unknowns }
 *   suggest is true | false | null. null means CANNOT TELL, not "no".
 */
export function suggestCardUpgrade(input, opts = {}) {
  const rawLines = Array.isArray(input) ? input : Array.isArray(input?.tradelines) ? input.tradelines : [];
  const { threshold, reason: thresholdReason } = readThreshold(opts.threshold);

  const utilization = evaluateUtilization(rawLines, { threshold: opts.threshold });
  const open = rawLines.map(readLine).filter((l) => !l.closed && l.kind !== "installment");

  const result = {
    suggest: null,
    reasons: [],
    threshold,
    utilization,
    bestApr: null,
    estimatedAnnualSavingCents: null,
    unknowns: {
      threshold: thresholdReason,
      lines: utilization.lines?.unknown ?? 0,
      linesMissingApr: open.filter((l) => l.apr === null).length
    }
  };

  if (thresholdReason) {
    result.unknowns.reason = thresholdReason;
    return result;
  }
  if (open.length === 0) {
    result.unknowns.reason = "no_open_revolving_lines";
    return result;
  }

  // --- utilization cases ---
  const perCardOver = (utilization.perLine ?? []).filter((r) => r.known && r.over);
  if (utilization.over === true) {
    result.reasons.push({
      code: UPGRADE_REASONS.AGGREGATE_UTILIZATION_OVER_THRESHOLD,
      evidence: { utilization: utilization.utilization, threshold, limitCents: utilization.limitCents, balanceCents: utilization.balanceCents }
    });
  } else if (perCardOver.length > 0) {
    result.reasons.push({
      code: UPGRADE_REASONS.PER_CARD_UTILIZATION_OVER_THRESHOLD,
      evidence: {
        threshold,
        cards: perCardOver.map((r) => ({ id: r.id, lender: r.lender, utilization: r.utilization }))
      }
    });
  }

  // --- price case: the client against their own cheapest open card ---
  const priced = open.filter((l) => l.apr !== null);
  if (priced.length >= 2) {
    const bestApr = Math.min(...priced.map((l) => l.apr));
    result.bestApr = bestApr;
    const dearer = priced.filter((l) => l.apr > bestApr && l.balanceCents !== null && l.balanceCents > 0);
    if (dearer.length > 0) {
      // Integer cents. roundHalfUp is money.mjs's, so this rounds the way every
      // other money figure in the repo rounds. Floating-point money is a live
      // defect here (src/affiliates/economics.mjs lands a cent short) and this is
      // not going to be the second one.
      const savingCents = dearer.reduce((s, l) => s + roundHalfUp(l.balanceCents * (l.apr - bestApr)), 0);
      result.estimatedAnnualSavingCents = savingCents;
      result.reasons.push({
        code: UPGRADE_REASONS.HIGH_APR_BALANCE,
        evidence: {
          bestApr,
          // One year of the rate difference, at today's balance. It is an
          // arithmetic statement about the numbers on file, NOT a projection: it
          // assumes the balance does not move and ignores fees, promo rates and
          // whether a transfer would even be approved.
          estimatedAnnualSavingCents: savingCents,
          cards: dearer.map((l) => ({ id: l.id, lender: l.lender, apr: l.apr, balanceCents: l.balanceCents }))
        }
      });
    }
  }

  // --- headroom case: only against a target the caller stated ---
  const target = readCents(opts.targetAmountCents);
  if (target !== null) {
    const headroomCents = (utilization.perLine ?? []).filter((r) => r.known).reduce((s, r) => s + r.headroomCents, 0);
    if (headroomCents < target) {
      result.reasons.push({
        code: UPGRADE_REASONS.LOW_HEADROOM,
        evidence: { headroomCents, targetAmountCents: target, shortfallCents: target - headroomCents, partial: utilization.partial === true }
      });
    }
  }

  // A definite YES is not made uncertain by an unrelated missing field, but a
  // NO cannot be stated while something relevant is still unknown — the card we
  // cannot read might be the one that is maxed. Same ordering classifySurvey()
  // uses in src/config/survey-qualification.mjs: a known failure beats a gap, a
  // gap beats a clean pass.
  const anythingUnknown = (utilization.lines?.unknown ?? 0) > 0;
  result.suggest = result.reasons.length > 0 ? true : anythingUnknown ? null : false;
  if (result.suggest === null && result.reasons.length === 0) result.unknowns.reason = "incomplete_lines";
  return result;
}

/* ─────────────────────────── 4. monthly report ─────────────────────────── */

/* Is an ISO timestamp inside [start, end]? Returns null when either end of the
   comparison is missing or unparseable — an alert with no raised_at is not "in
   the period" and it is not "outside" it, it is uncounted, and it gets its own
   tally so the gap is visible instead of rounding into one of the real buckets. */
function withinPeriod(at, period) {
  if (!period || !period.start || !period.end || at === null || at === undefined || at === "") return null;
  const t = Date.parse(at instanceof Date ? at.toISOString() : String(at));
  const a = Date.parse(period.start instanceof Date ? period.start.toISOString() : String(period.start));
  const b = Date.parse(period.end instanceof Date ? period.end.toISOString() : String(period.end));
  if (!Number.isFinite(t) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return t >= a && t <= b;
}

function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r?.[key] ?? "(none)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * monthlyReport — a periodic summary of utilization, score banding, upsell cases
 * and alert state.
 *
 * PURE, AND THAT INCLUDES THE DATE. It does not know what month it is and it does
 * not go and get the rows. `period` is whatever the caller passes — omit it and
 * nothing is filtered by date, which is reported as `periodApplied: false` rather
 * than assumed. There is no `new Date()` anywhere in this file; a report that
 * invents its own period cannot be re-run to produce the same answer, and a
 * report you cannot reproduce is not evidence of anything.
 *
 * @param {object} input
 * @param {{start,end}|null} [input.period]
 * @param {Array} [input.clients]  [{ clientId, tradelines: [...], score }]
 * @param {Array} [input.alerts]   `alerts` rows (078)
 * @param {number|null} [input.threshold]
 * @returns {object} { period, periodApplied, clients: [...], totals: {...} }
 */
export function monthlyReport(input = {}) {
  const period = input.period ?? null;
  const clientsIn = Array.isArray(input.clients) ? input.clients : [];
  const alertsIn = Array.isArray(input.alerts) ? input.alerts : [];
  const threshold = input.threshold;

  const clients = clientsIn.map((c) => {
    const tradelines = Array.isArray(c?.tradelines) ? c.tradelines : [];
    const utilization = evaluateUtilization(tradelines, { threshold });
    const score = evaluateScore(c?.score);
    const upsell = suggestCardUpgrade({ tradelines }, { threshold, targetAmountCents: c?.targetAmountCents });
    return { clientId: c?.clientId ?? null, utilization, score, upsell };
  });

  // Every client lands in exactly one utilization bucket, and "unknown" is one of
  // them. The three counts plus `partial` must add back up to the client count —
  // a summary where the buckets do not reconcile is how an unknown quietly
  // becomes a zero.
  const utilOver = clients.filter((c) => c.utilization.over === true).length;
  const utilUnder = clients.filter((c) => c.utilization.over === false).length;
  const utilUnknown = clients.filter((c) => c.utilization.over === null).length;

  const byBand = {};
  for (const c of clients) {
    const k = c.score.known ? (c.score.band ?? "(below lowest named band)") : "(unknown)";
    byBand[k] = (byBand[k] ?? 0) + 1;
  }

  const savings = clients
    .map((c) => c.upsell.estimatedAnnualSavingCents)
    .filter((v) => typeof v === "number");

  const periodApplied = Boolean(period && period.start && period.end);
  const inPeriod = alertsIn.filter((a) => withinPeriod(a?.raised_at ?? a?.raisedAt, period) === true);
  const undated = alertsIn.filter((a) => withinPeriod(a?.raised_at ?? a?.raisedAt, period) === null);
  const scopedAlerts = periodApplied ? inPeriod : alertsIn;

  return {
    period,
    periodApplied,
    threshold: readThreshold(threshold).threshold,
    clients,
    totals: {
      clients: clients.length,
      utilization: {
        overThreshold: utilOver,
        atOrUnderThreshold: utilUnder,
        unknown: utilUnknown,
        partial: clients.filter((c) => c.utilization.partial === true).length
      },
      scores: {
        known: clients.filter((c) => c.score.known).length,
        unknown: clients.filter((c) => !c.score.known).length,
        meetsFundingCallGate: clients.filter((c) => c.score.meetsFundingCallGate === true).length,
        byBand
      },
      upsell: {
        candidates: clients.filter((c) => c.upsell.suggest === true).length,
        notCandidates: clients.filter((c) => c.upsell.suggest === false).length,
        // Cannot tell. Reported on its own line so it is never read as a "no".
        undetermined: clients.filter((c) => c.upsell.suggest === null).length,
        // Sum of a same-card comparison, not a promise of money saved.
        estimatedAnnualSavingCents: savings.length ? savings.reduce((s, v) => s + v, 0) : null
      },
      alerts: {
        total: alertsIn.length,
        counted: scopedAlerts.length,
        // Alerts with no readable raised_at. Not in, not out — uncounted, and
        // said out loud.
        undated: periodApplied ? undated.length : 0,
        byState: tally(scopedAlerts, "state"),
        bySeverity: tally(scopedAlerts, "severity"),
        byKind: tally(scopedAlerts, "kind")
      }
    }
  };
}
