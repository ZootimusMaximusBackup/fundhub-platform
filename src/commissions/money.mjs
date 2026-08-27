// @ts-check
// Money. Integer cents, everywhere, always.
//
// Commission is percentages of percentages of splits. Doing that in floats
// produces a payout report that is off by a penny and a rep who does not trust
// the system. Every amount crosses into this module as cents on the way in and
// leaves as a fixed 2dp string on the way out.
//
// Pure. No side effects, no clock, no I/O.

/** Largest magnitude we will accept, in cents. $1bn — a guard against a typo'd
 *  input silently producing garbage rather than an error. */
const MAX_CENTS = 100_000_000_000;

/**
 * Round half away from zero. JS Math.round breaks ties toward +Infinity, which
 * makes -0.5 round to -0 and gives clawbacks a different rounding rule from the
 * commissions they reverse. This rounds symmetrically so a full reversal always
 * exactly cancels the row it reverses.
 */
export function roundHalfUp(x) {
  if (!Number.isFinite(x)) throw new TypeError(`roundHalfUp: not a finite number: ${x}`);
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * Decimal amount -> integer cents.
 * Accepts a number, a numeric string, or a pg numeric (which arrives as a string).
 * null/undefined/'' -> 0, because "no payments yet" is a legitimate zero base.
 */
export function toCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new TypeError(`toCents: not a number: ${JSON.stringify(value)}`);
  const cents = roundHalfUp(n * 100);
  if (Math.abs(cents) > MAX_CENTS) {
    throw new RangeError(`toCents: amount out of range: ${value}`);
  }
  return cents;
}

/** Integer cents -> fixed 2dp string, ready for a numeric(14,2) column. */
export function fromCents(cents) {
  if (!Number.isInteger(cents)) throw new TypeError(`fromCents: not an integer: ${cents}`);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/**
 * Percent of an amount. `percent` is in PERCENT UNITS as stored in the
 * commission_rules.percent column: 0.25 means 0.25%, 10 means 10%.
 */
export function percentOf(cents, percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) throw new TypeError(`percentOf: bad percent: ${percent}`);
  if (p < 0) throw new RangeError(`percentOf: negative percent: ${percent}`);
  return roundHalfUp((cents * p) / 100);
}

/** Apply a split share. splitPercent 50 -> half. */
export function applySplit(cents, splitPercent) {
  const p = Number(splitPercent);
  if (!Number.isFinite(p)) throw new TypeError(`applySplit: bad split: ${splitPercent}`);
  if (p <= 0 || p > 100) throw new RangeError(`applySplit: split out of range: ${splitPercent}`);
  return roundHalfUp((cents * p) / 100);
}

/**
 * Whole units of `unitCents` inside `cents`, for flat_per_unit.
 * Partial units do not pay — $5,999 against a $3,000 unit is one unit, not 1.99.
 */
export function wholeUnits(cents, unitCents) {
  if (!Number.isInteger(unitCents) || unitCents <= 0) {
    throw new RangeError(`wholeUnits: unit must be a positive integer: ${unitCents}`);
  }
  return Math.floor(Math.abs(cents) / unitCents) * (cents < 0 ? -1 : 1);
}

/**
 * Clamp to a rule's min_amount / max_amount guardrails. Either bound may be
 * null. Applied on the magnitude so a reversal is clamped the same way the
 * original was, keeping the two exactly equal and opposite.
 *
 * Zero is left alone deliberately: a min_amount floor is a "pay at least this
 * much when this rule fires", not "pay this much when nothing was collected".
 * No base, no commission.
 */
export function clampAmount(cents, minCents, maxCents) {
  if (cents === 0) return 0;
  const sign = cents < 0 ? -1 : 1;
  let abs = Math.abs(cents);
  if (minCents !== null && minCents !== undefined) abs = Math.max(abs, Math.abs(minCents));
  if (maxCents !== null && maxCents !== undefined) abs = Math.min(abs, Math.abs(maxCents));
  return abs * sign;
}
