// Statement cycle arithmetic. The month-end rule lives here and NOWHERE ELSE.
//
// PURE. No database, no clock, no I/O. `today` is always a parameter, never
// read from the system clock — same discipline as recurring.mjs next door, and
// for the same reason: a function that reads the clock cannot be tested for what
// it does on 29 February without changing the machine's date.
//
//
// *** DATES ARE STRINGS HERE, NOT Date OBJECTS. ***
//
// Everything in and out is an ISO calendar date, "YYYY-MM-DD". No Date object
// crosses this module's boundary and none is constructed inside it except where
// noted.
//
// WHY. A statement closes on a calendar day, not at an instant. `new Date("2026-
// 02-28")` parses as UTC midnight, and in any timezone west of Greenwich
// `.getDate()` on it returns 27. That single line has produced off-by-one due
// dates in more systems than any other date bug there is, and it fails silently:
// the number is a real date, just the wrong one, and only for some users. Working
// in {year, month, day} integers makes the class of bug unrepresentable.
//
//
// *** THE MONTH-END RULE. ***
//
// A day-of-month past the end of a given month CLAMPS to the last day of that
// month. A cycle whose day is 31 falls on 28 February, or 29 in a leap year.
//
// THE REJECTED ALTERNATIVE is spilling into the next month — 31 February
// becoming 3 March. That moves a due date across a month boundary, which makes a
// payment made on the last day of February look late, and makes a "due this
// month" query miss the payment entirely. Clamping can be a day or three early;
// spilling is wrong in a way that costs money.
//
// Migration 096's header states this rule and points here. If migration 091 on
// the parallel branch chose differently for recurring bill anchor days, the two
// must be reconciled into this function before both ship.

/** Days in a month. `month` is 1-12, human-numbered, NOT the 0-11 that Date uses
 *  — the off-by-one between those two conventions is its own bug family, so this
 *  module never uses the 0-11 form anywhere. */
export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new TypeError(`daysInMonth: bad year/month: ${year}/${month}`);
  }
  // Day 0 of month N+1 is the last day of month N. Date's month argument is
  // 0-based, so `month` (1-based) is already "next month" to it. UTC throughout:
  // this is the one place a Date is built, and it never leaves.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamp a day-of-month to a real day in that month. 31 in February → 28 or 29. */
export function clampDayToMonth(year, month, day) {
  const last = daysInMonth(year, month);
  return day > last ? last : day;
}

/** "YYYY-MM-DD" → { year, month, day }, or null if it is not one.
 *  Rejects rather than guesses: a malformed date must not silently become today. */
export function parseIsoDate(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** { year, month, day } → "YYYY-MM-DD". */
export function formatIsoDate({ year, month, day }) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The next date on or after `fromIso` that falls on `day` of the month, with the
 * month-end rule applied.
 *
 * ON OR AFTER, not strictly after. A payment due today is due today; treating it
 * as due next month would hide the one that matters most.
 *
 * Returns null for an unusable input rather than throwing — an absent or
 * malformed day is an ordinary state here (the owner has not filled that field
 * in yet), not an exception.
 */
export function nextOccurrence(day, fromIso) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const from = parseIsoDate(fromIso);
  if (!from) return null;

  const thisMonth = clampDayToMonth(from.year, from.month, day);
  if (thisMonth >= from.day) {
    return formatIsoDate({ year: from.year, month: from.month, day: thisMonth });
  }

  const year = from.month === 12 ? from.year + 1 : from.year;
  const month = from.month === 12 ? 1 : from.month + 1;
  return formatIsoDate({ year, month, day: clampDayToMonth(year, month, day) });
}

/** Whole days from `fromIso` to `toIso`. Negative if `toIso` is in the past.
 *  Null if either is unparseable. Both are calendar dates, so this is exact —
 *  no daylight-saving hour to lose. */
export function daysBetween(fromIso, toIso) {
  const a = parseIsoDate(fromIso), b = parseIsoDate(toIso);
  if (!a || !b) return null;
  const ms = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86400000);
}

/* -------------------------------------------------------------------------- *
 * The answers a screen actually asks for
 * -------------------------------------------------------------------------- */

/** Why a date could not be computed. Mirrors 086's
 *  `next_expected_unknown_reason`: an unanswerable question gets a NAMED reason,
 *  not a null that every caller has to re-derive. The screen prints the reason. */
export const UNKNOWN_REASONS = {
  NO_DUE_DAY: "no_payment_due_day",
  NO_CLOSE_DAY: "no_statement_close_day",
  BAD_TODAY: "invalid_reference_date"
};

/**
 * nextDueDate(cycle, { today }) → { dueOn, daysAway, unknownReason }
 *
 * `dueOn` is null whenever it cannot be known, and `unknownReason` says which
 * field is missing. NEVER returns a guessed date. A dashboard that invents a due
 * date is worse than one that admits it does not have one — the owner would plan
 * a payment around it.
 *
 * `cycle` takes the column names from 096 verbatim, so a row read out of the
 * database can be passed straight in with no mapping layer to drift.
 */
export function nextDueDate(cycle, { today } = {}) {
  const none = (unknownReason) => ({ dueOn: null, daysAway: null, unknownReason });

  if (!parseIsoDate(today)) return none(UNKNOWN_REASONS.BAD_TODAY);

  const day = cycle?.payment_due_day;
  if (day === null || day === undefined) return none(UNKNOWN_REASONS.NO_DUE_DAY);

  const dueOn = nextOccurrence(Number(day), today);
  if (!dueOn) return none(UNKNOWN_REASONS.NO_DUE_DAY);

  return { dueOn, daysAway: daysBetween(today, dueOn), unknownReason: null };
}

/**
 * nextStatementClose(cycle, { today }) — the same shape for the closing date.
 *
 * Separate from the due date because they are separate facts and a card can have
 * one without the other. The owner may know his payment is due on the 2nd and
 * have no idea when the statement closes.
 */
export function nextStatementClose(cycle, { today } = {}) {
  const none = (unknownReason) => ({ closesOn: null, daysAway: null, unknownReason });

  if (!parseIsoDate(today)) return none(UNKNOWN_REASONS.BAD_TODAY);

  const day = cycle?.statement_close_day;
  if (day === null || day === undefined) return none(UNKNOWN_REASONS.NO_CLOSE_DAY);

  const closesOn = nextOccurrence(Number(day), today);
  if (!closesOn) return none(UNKNOWN_REASONS.NO_CLOSE_DAY);

  return { closesOn, daysAway: daysBetween(today, closesOn), unknownReason: null };
}

export default {
  daysInMonth,
  clampDayToMonth,
  parseIsoDate,
  formatIsoDate,
  nextOccurrence,
  daysBetween,
  nextDueDate,
  nextStatementClose,
  UNKNOWN_REASONS
};
