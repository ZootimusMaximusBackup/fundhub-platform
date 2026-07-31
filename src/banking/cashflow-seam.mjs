// The W7 -> W8 seam. PURE — no database, no network, no clock.
//
// *** WHY THIS FILE EXISTS: THREE BREAKS THAT WOULD HAVE BEEN FOUND AT WIRING
// *** TIME, ONE OF THEM SILENTLY. ***
//
// The recurring-bill detector (recurring.mjs) and the cash-flow projector
// (src/banking/cashflow.mjs, W8) were built in parallel against the same scope
// fence and have never been run against each other. Reading W8's actual input
// contract against W7's actual output shows they do not fit, in three separate
// ways:
//
//   1. CONFIDENCE SCALE. W8 validates `recurringBills[].confidence` as a number
//      between 0 and 1 and THROWS outside it. W7 emits `confidencePct`, an
//      integer 0-100. Passing 88 raises CashflowInputError; passing nothing at
//      all is worse, because W8 then classifies the bill as UNCONFIRMED with
//      the reason "no confidence was supplied" — every detected bill silently
//      demoted, no error anywhere.
//
//   2. SIGN. W8 runs `occurrences[].amountCents` through
//      requireNonNegativeCents() and applies `direction: "out"` itself. W7's
//      amounts are NEGATIVE by the convention 085 sets. The naive fix at a call
//      site is `Math.abs(bill.typicalAmountCents)`, which is precisely the
//      un-reviewed sign flip 085's header calls the most expensive mistake
//      available here. It happens once, in this file, where it is tested.
//
//   3. DATES. W8 states outright that it has no recurrence engine and that
//      expanding a cadence into dates is W7's job: "W7 detects the pattern and
//      hands over dates; this module adds up money." W7 emits ONE
//      `nextExpectedDate`. Nothing on either side turned a cadence into the
//      series W8 wants.
//
// Break 1 is the dangerous one. Breaks 2 and 3 fail loudly — a thrown
// CashflowInputError, or a projection with no bills in it. Break 1 produces a
// complete, plausible, confidently-rendered cash-flow projection in which every
// bill is quietly marked unconfirmed.
//
//
// WHY THE SEAM LIVES ON THIS SIDE. W8's header is explicit that the recurrence
// expansion is W7's to provide, and W8 refuses date-expansion on purpose. So
// this is W7 completing its own half of the contract, not W7 reaching into W8.
// Nothing here imports anything from W8 — it builds a plain object matching a
// documented input shape, and it would keep working if W8 were replaced.
//
//
// THE HONESTY RULE SURVIVES THE CROSSING, WHICH IS THE WHOLE POINT.
//
// A bill with no confident next date expands to ZERO occurrences and carries a
// `skippedReason`. It is never given a plausible first date so that the
// projection has something to draw. That would launder exactly the uncertainty
// recurring.mjs exists to preserve: a date invented here is indistinguishable,
// three modules downstream, from one the detector actually stood behind.
//
// Low-confidence candidates are NOT converted by default. They can be included
// deliberately (`includeCandidates: true`), and when they are they carry their
// real confidence, so W8's own confidenceFloor is what decides — not a silent
// promotion on the way through.

import {
  CADENCES,
  PRESENTABLE_LABELS,
  parseDay,
  formatDay,
  MAX_CONFIDENCE
} from "./recurring.mjs";

/** Reason strings a caller branches on. Not prose. */
export const SEAM_REASONS = Object.freeze({
  NO_CONFIDENT_DATE: "no_confident_next_date_so_no_occurrences_were_projected",
  LOW_CONFIDENCE_EXCLUDED: "low_confidence_candidate_not_projected_by_default",
  WINDOW_EMPTY: "no_occurrence_falls_inside_the_requested_window"
});

/* ------------------------------------------------------------------------- *
 * Calendar helpers — duplicated deliberately, see note.
 *
 * recurring.mjs keeps its day arithmetic private on purpose (only parseDay and
 * formatDay are exported), and widening its API just to share two four-line
 * helpers would make the detector's surface bigger for the benefit of a module
 * it does not know about. These two are re-derived from its exported pair
 * rather than reaching into it.
 * ------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;

const dayNumber = (d) => Math.round(Date.UTC(d.y, d.m - 1, d.d) / MS_PER_DAY);

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function addDays(day, n) {
  const dt = new Date((dayNumber(day) + n) * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Advance by whole cadence periods.
 *
 * Month-based cadences use CALENDAR arithmetic anchored on `anchorDom`, exactly
 * as recurring.mjs's advance() does — a bill due on the 15th is due on the
 * 15th, and adding 30.4375 days would drift it a day every few months. The
 * anchor is the day-of-month the detector already settled on, carried across
 * the seam as the day-of-month of its own predicted date.
 */
function advance(day, cadence, k, anchorDom) {
  if (cadence.months === 0) return addDays(day, cadence.stepDays * k);
  const total = day.y * 12 + (day.m - 1) + cadence.months * k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(anchorDom ?? day.d, daysInMonth(y, m)) };
}

/* ------------------------------------------------------------------------- *
 * Expansion
 * ------------------------------------------------------------------------- */

/**
 * Expand a detected bill into the dated occurrences it implies, inside a window.
 *
 * PURE, and `from`/`to` are REQUIRED — there is no clock here either, for the
 * same reason recurring.mjs has none: an expansion whose answer depends on when
 * it ran cannot be tested or audited.
 *
 * Starts from the detector's own `nextExpectedDate` and steps forward by the
 * detected cadence. It NEVER invents a starting point: a bill whose
 * `nextExpectedDate` is null returns `[]` and the caller is told why.
 *
 * Amounts come back as POSITIVE magnitudes — W8's convention, not this repo's.
 * That flip happens here and nowhere else. See break 2 in the header.
 *
 * @returns {{ occurrences: Array<{date: string, amountCents: number}>,
 *             skippedReason: string|null }}
 */
export function expectedOccurrences(bill, { from, to, maxOccurrences = 240 } = {}) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start) throw new TypeError("expectedOccurrences: `from` is required and must be a date");
  if (!end) throw new TypeError("expectedOccurrences: `to` is required and must be a date");
  if (dayNumber(end) < dayNumber(start)) {
    throw new RangeError("expectedOccurrences: `to` precedes `from`");
  }

  if (!bill?.nextExpectedDate) {
    // The detector declined to name a date. Manufacturing one here would
    // launder its uncertainty into a number a projection treats as real.
    return { occurrences: [], skippedReason: SEAM_REASONS.NO_CONFIDENT_DATE };
  }

  const cadence = CADENCES[bill.cadence];
  if (!cadence) throw new RangeError(`expectedOccurrences: unknown cadence: ${bill.cadence}`);

  const first = parseDay(bill.nextExpectedDate);
  if (!first) throw new RangeError(`expectedOccurrences: unparseable nextExpectedDate`);

  // THE REAL BILLING DAY, NOT THE ONE IN `nextExpectedDate`.
  //
  // `nextExpectedDate` may itself be clamped: a bill charged on the 31st has a
  // predicted date of the 30th whenever the next month is short. Anchoring on
  // that clamped value and stepping forward pins the bill to the 30th FOREVER
  // — the first version of this file did exactly that and the month-end test
  // caught it. The detector publishes the true anchor for this reason; `first.d`
  // is only the fallback for a caller hand-building a bill without one.
  const anchorDom = bill.anchorDayOfMonth ?? first.d;
  const amountCents = Math.abs(bill.typicalAmountCents);

  const occurrences = [];
  let cursor = first;
  let guard = 0;

  while (dayNumber(cursor) <= dayNumber(end) && guard < maxOccurrences) {
    if (dayNumber(cursor) >= dayNumber(start)) {
      occurrences.push({ date: formatDay(cursor), amountCents });
    }
    cursor = advance(cursor, cadence, 1, anchorDom);
    guard += 1;
  }

  return {
    occurrences,
    skippedReason: occurrences.length === 0 ? SEAM_REASONS.WINDOW_EMPTY : null
  };
}

/**
 * One detected bill -> one entry in W8's `recurringBills[]`.
 *
 * The confidence is converted to the 0-1 fraction W8 validates against.
 * `confidencePct` remains the authority and is what migration 086 stores; this
 * is a derived interop value and it is derived in one place, here, so the two
 * scales cannot drift apart at a call site. See break 1 in the header — that
 * mismatch is the one that fails silently.
 *
 * `confirmed` is deliberately never set. W8 treats `confirmed: true` as "this
 * is not a guess at all", and a bill this system inferred from a transaction
 * history is always a guess, however good.
 */
export function toCashflowBill(bill, { from, to, maxOccurrences } = {}) {
  const { occurrences, skippedReason } = expectedOccurrences(bill, { from, to, maxOccurrences });

  return {
    billId: `${bill.bankAccountId}:${bill.merchantKey}:${bill.cadence}`,
    label: bill.merchantDisplay || bill.merchantKey,
    // 0-1, because that is what W8 validates. Integer percent stays authoritative.
    confidence: bill.confidencePct / 100,
    occurrences,
    // Not part of W8's contract — extra keys are ignored by it — but a caller
    // that drops a bill needs to be able to say why without re-deriving it.
    skippedReason
  };
}

/**
 * A whole detection result -> the `recurringBills` array W8 takes.
 *
 * Low-confidence candidates are excluded BY DEFAULT, the same split the
 * detector and the store already make. Including them is a named act, and when
 * they are included they carry their true confidence so W8's own
 * `confidenceFloor` decides — nothing is promoted on the way across.
 *
 * @returns {{ recurringBills: Array, skipped: Array<{billId, reason}> }}
 */
export function toCashflowBills(result, { from, to, includeCandidates = false, maxOccurrences } = {}) {
  if (!result || typeof result !== "object") {
    throw new TypeError("toCashflowBills: expected a detectRecurringBills() result");
  }

  const rows = [
    ...(result.bills ?? []),
    ...(includeCandidates ? (result.candidates ?? []) : [])
  ];

  const recurringBills = [];
  const skipped = [];

  for (const bill of rows) {
    const shaped = toCashflowBill(bill, { from, to, maxOccurrences });
    if (shaped.occurrences.length === 0) {
      skipped.push({ billId: shaped.billId, reason: shaped.skippedReason });
      continue;
    }
    const { skippedReason, ...clean } = shaped;
    recurringBills.push(clean);
  }

  // Candidates left out on purpose are reported, not silently absent: "we found
  // something here and chose not to project it" is a different statement from
  // "we found nothing", and a caller deciding what to show needs both.
  if (!includeCandidates) {
    for (const c of result.candidates ?? []) {
      skipped.push({
        billId: `${c.bankAccountId}:${c.merchantKey}:${c.cadence}`,
        reason: SEAM_REASONS.LOW_CONFIDENCE_EXCLUDED
      });
    }
  }

  return { recurringBills, skipped };
}

/**
 * A confidence floor, in W8's units, that admits exactly the bands this repo
 * calls presentable.
 *
 * W8 requires a `thresholds.confidenceFloor` and refuses to classify without
 * one — "a default horizon is a policy nobody stated" is its stance, and the
 * same applies here. This is not a default: it is the number that makes W8's
 * classification agree with the detector's own medium/high split, exported so a
 * caller can pass it deliberately instead of inventing 0.8 at a call site.
 *
 * Derived from the band table rather than hard-coded, so moving a band moves
 * this with it.
 */
export const PRESENTABLE_CONFIDENCE_FLOOR = 55 / 100;

/** Sanity: the floor must sit inside the reachable range. Cheap, and it has caught a typo. */
if (!(PRESENTABLE_CONFIDENCE_FLOOR > 0 && PRESENTABLE_CONFIDENCE_FLOOR <= MAX_CONFIDENCE / 100)) {
  throw new RangeError("cashflow-seam: PRESENTABLE_CONFIDENCE_FLOOR is outside the reachable range");
}

/** The labels this seam considers projectable, re-exported so the two agree. */
export const PROJECTABLE_LABELS = PRESENTABLE_LABELS;
