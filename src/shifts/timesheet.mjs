// Timesheet + compensation math. THIS IS MONEY.
//
// Integer cents everywhere, via src/commissions/money.mjs. No floats reach a
// payable amount: the only division in this file feeds roundHalfUp immediately,
// which is the same shape percentOf() already uses. Pure — no clock, no I/O, no
// database. Shift rows come in as arguments; nothing here reads `shifts`.
//
// ── WHAT THIS FILE IS NOT ───────────────────────────────────────────────────
// It is not the commission ledger. src/commissions/ computes commission from
// database-held rules; every rate there is a row, never a constant. This file
// is payroll — the hourly wage off `shifts` plus the two flat comp lines the
// build plan states for the advisor and the closer — and it is the thing
// src/commissions/commission-model-open-questions.md §8 explicitly puts OUT of
// the commission model's scope:
//
//     "### 8. `$6.25/hr` is payroll, not commission ✅  … It is hourly wage off
//      `shifts`, and nothing in this model touches it. … If a timesheet screen
//      wants to show 'wage + commission' side by side it can read both."
//
// This is that timesheet side. The two must not be summed into one number by
// anything that does not know it is doing it.
//
// ── ROUNDING RULE (decided here, stated once) ───────────────────────────────
// TIME IS NOT ROUNDED. Not to the quarter hour, not to the minute. Each shift
// contributes floor(milliseconds / 1000) whole seconds and the seconds are
// summed exactly; the one and only rounding in the pay path is the final
// half-up to the cent, done once, by money.mjs.
//
// Why not the quarter hour, which is what payroll systems usually do: a
// rounding increment is an employment-policy decision with legal weight (it has
// to be neutral over time, and a system that rounds down on arrival and up on
// departure is a wage claim), and THERE IS NO SOURCE FOR ONE ANYWHERE IN THIS
// REPOSITORY — not in the schema, not in src/config/, not in any doc on disk.
// Rather than pick an increment and bake a policy nobody chose into the pay of
// every hour worked, this file rounds nothing and pays the seconds that were
// actually logged. If someone decides on an increment later, it applies to
// secondsWorked() at one call site; it does not change any of the money below.
//
// Sub-second remainders are floored per shift rather than accumulated. At
// $6.25/hr one second is 0.17 cents, so the floor costs a fraction of a cent
// per shift and buys a total that does not wobble with millisecond jitter in
// the timestamps. Partial units do not pay — the same rule wholeUnits() states.
//
// ── THE BONUS SEAM ─────────────────────────────────────────────────────────
// Bonus structuring is owned elsewhere and is deliberately NOT modelled here.
// There is no tier, no accelerator, no multiplier, no kicker, no threshold in
// this file, and nothing in it is shaped to imply what one would look like.
// What is here instead is a return shape a bonus layer can extend without
// rewriting anything: every comp function returns `components[]` — one entry
// per line of pay, each carrying its own basis and the value it was computed
// from — plus `base_cents` (the sum of those components) and `total_cents`.
//
// `total_cents === base_cents` by construction in this file. A bonus layer
// appends its own components and recomputes `total_cents`; `base_cents` stays
// what the base plan produced, so "what did the plan pay" and "what did we pay"
// never collapse into one unauditable number. That is the entire seam. This
// file must not grow a bonus branch.

import { percentOf, roundHalfUp, wholeUnits } from "../commissions/money.mjs";

/* ── RATES ──────────────────────────────────────────────────────────────────
   Named, exported, in cents. Not inline magic numbers, and not looked up:
   these four numbers come from the build plan's statement of the comp
   structure ($6.25/hr, 0.25% of funded, $500 per $3K deposit) and have NO ROW
   ANYWHERE IN THIS DATABASE. `staff.comp` is a jsonb column that exists and is
   empty — nothing in the repo reads or writes it — and there is no payroll
   config table. So they live here, in one block, named after what they are,
   and the day they become configuration this is the block that gets deleted.
   Reported as a gap rather than presented as sourced. */

/** $6.25 per hour, in cents. Payroll, not commission (see §8 above). */
export const ADVISOR_HOURLY_RATE_CENTS = 625;

/** Seconds in an hour. Not money — named so the pay formula reads as a formula
 *  rather than as an unexplained 3600. */
export const SECONDS_PER_HOUR = 3600;

/**
 * 0.25% of funded, in PERCENT UNITS, because that is what percentOf() takes:
 * `percentOf(cents, 0.25)` is a quarter of one percent. It is NOT a fraction
 * and it is NOT cents — a percentage cannot be expressed in cents, and writing
 * 0.0025 here would silently pay a hundredth of the intended amount.
 * Both the advisor and the closer earn the same 0.25% line.
 */
export const FUNDED_PERCENT = 0.25;

/** The $3,000 deposit unit the closer's flat is measured against, in cents. */
export const CLOSER_DEPOSIT_UNIT_CENTS = 300_000;

/** The $500 flat itself, in cents. */
export const CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS = 50_000;

/* ── INPUT DISCIPLINE ───────────────────────────────────────────────────────
   Money in, money out, and nothing in between that could become NaN cents. */

/**
 * An amount the caller may legitimately not know. Returns the integer, or null
 * when it was not supplied.
 *
 * NULL IS NOT ZERO AND MUST SURVIVE. `fundedCents: null` means "nobody has told
 * this function how much funded" and `fundedCents: 0` means "nothing funded".
 * Collapsing the first into the second pays 0.25% of a number that was never
 * checked, and the payout report shows a confident $0.00 where it should show
 * that it does not know. So an unknown propagates: its component is null, and
 * the total it feeds is null.
 *
 * This deliberately diverges from toCents(), which maps null to 0 — that is the
 * right call there (it sums a list of payments, and an empty list really is
 * zero) and the wrong one here, where the argument is a single fact that either
 * was or was not supplied.
 */
function knownCents(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label}: expected integer cents, got ${JSON.stringify(value)}`);
  }
  if (value < 0) {
    // A negative here is a reversal, and a reversal is not a comp calculation
    // run backwards — src/commissions/calculate.mjs reverseDraft() exists for
    // that and makes prorating a deliberate act. Refusing keeps a sign error in
    // an upstream sum from quietly issuing a negative paycheque line.
    throw new RangeError(`${label}: negative amounts are not compensation: ${value}`);
  }
  return value;
}

/** Whole seconds the caller may legitimately not know. Same null discipline as
 *  knownCents(): absent means unknown, and unknown propagates rather than
 *  becoming a zero-hour week. */
function knownSeconds(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label}: expected whole seconds, got ${JSON.stringify(value)}`);
  }
  if (value < 0) {
    throw new RangeError(`${label}: negative time is not a wage: ${value}`);
  }
  return value;
}

/** Milliseconds since epoch from a pg timestamptz (a Date) or an ISO string.
 *  A bare number is REFUSED: seconds and milliseconds are indistinguishable at
 *  a glance and guessing wrong is a factor-of-1000 error in someone's pay. */
function instantMs(value, label) {
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) throw new TypeError(`${label}: invalid Date`);
    return t;
  }
  if (typeof value === "string") {
    const t = Date.parse(value);
    if (Number.isNaN(t)) throw new TypeError(`${label}: unparseable timestamp: ${JSON.stringify(value)}`);
    return t;
  }
  throw new TypeError(`${label}: expected a Date or an ISO timestamp string, got ${JSON.stringify(value)}`);
}

/* ── TIME ───────────────────────────────────────────────────────────────────
   The column names are started_at / ended_at, exactly as in 001_init.sql:393.
   camelCase is NOT accepted: a row read out of Postgres carries snake_case, so
   a `startedAt` key means the caller built the object by hand and is one typo
   away from silently timing every shift from `undefined`. It throws instead. */

/**
 * shiftSeconds(shift) — whole logged seconds in one shift row.
 *
 * AN OPEN SHIFT CONTRIBUTES NOTHING. `ended_at IS NULL` is the schema's
 * definition of open (it is the predicate on both indexes, and on
 * uq_shifts_one_open). Someone still on the clock has no logged span yet, and
 * paying them up to "now" would make this function's answer depend on when it
 * was called — the same defect autoCloseStale() avoids by not stamping its own
 * clock. Zero is not a claim that they worked nothing; it is that nothing has
 * been logged yet.
 */
export function shiftSeconds(shift) {
  if (shift === null || typeof shift !== "object" || Array.isArray(shift)) {
    throw new TypeError(`shiftSeconds: expected a shift row, got ${JSON.stringify(shift)}`);
  }
  // Validated even when the shift is open: started_at is NOT NULL in the
  // schema, so a missing or garbage one is corruption, and corruption that
  // happens to sit on an open shift should still be seen.
  const startedAt = instantMs(shift.started_at, "shiftSeconds: started_at");

  if (shift.ended_at === null || shift.ended_at === undefined) return 0;
  const endedAt = instantMs(shift.ended_at, "shiftSeconds: ended_at");

  const ms = endedAt - startedAt;
  if (ms < 0) {
    // Not clamped to zero. A shift that ends before it starts is a broken row,
    // and quietly paying it as zero hides the break from the only person who
    // could fix it while still producing a payable timesheet.
    throw new RangeError(
      `shiftSeconds: shift ended before it started (started_at=${shift.started_at}, ended_at=${shift.ended_at})`
    );
  }
  return Math.floor(ms / 1000);
}

/**
 * secondsWorked(shifts) — total whole seconds logged across shift rows.
 * THIS is the money-grade number; hoursWorked() below is the human-readable
 * view of the same fact and never touches a rate.
 */
export function secondsWorked(shifts) {
  if (!Array.isArray(shifts)) {
    throw new TypeError(`secondsWorked: expected an array of shift rows, got ${JSON.stringify(shifts)}`);
  }
  let total = 0;
  for (const shift of shifts) total += shiftSeconds(shift);
  return total;
}

/**
 * hoursWorked(shifts) — total logged time expressed in hours.
 *
 * FOR DISPLAY AND REPORTING. Not for money: it is seconds / 3600, which is a
 * repeating decimal for most real timesheets, and a decimal number of hours
 * multiplied by a rate is exactly the float path this repository forbids. The
 * pay path goes through secondsWorked() -> hourlyCents() and never sees this
 * value. It is returned unrounded on purpose — see the rounding rule in the
 * header: the time itself is not rounded, so this function does not invent a
 * precision either.
 */
export function hoursWorked(shifts) {
  return secondsWorked(shifts) / SECONDS_PER_HOUR;
}

/**
 * hourlyCents(secondsLogged) — the wage line, in integer cents.
 * seconds x rate is an exact integer; the division by 3600 is the only float
 * step and it feeds roundHalfUp immediately, the same shape percentOf() uses.
 */
export function hourlyCents(secondsLogged) {
  if (typeof secondsLogged !== "number" || !Number.isInteger(secondsLogged)) {
    throw new TypeError(`hourlyCents: expected whole seconds, got ${JSON.stringify(secondsLogged)}`);
  }
  if (secondsLogged < 0) {
    throw new RangeError(`hourlyCents: negative time is not a wage: ${secondsLogged}`);
  }
  return roundHalfUp((secondsLogged * ADVISOR_HOURLY_RATE_CENTS) / SECONDS_PER_HOUR);
}

/* ── COMP ───────────────────────────────────────────────────────────────────
   Both functions return the same shape. See "THE BONUS SEAM" in the header. */

/** Sum of component amounts, with unknown poisoning the total: if any line is
 *  null the total is null, because a total that silently omits an unknown line
 *  is a smaller number presented as a complete one. */
function sumComponents(components) {
  let total = 0;
  for (const c of components) {
    if (c.cents === null) return null;
    total += c.cents;
  }
  return total;
}

function breakdown(role, components) {
  const base = sumComponents(components);
  return {
    role,
    components,
    base_cents: base,
    // Equal to base_cents here, always. It exists so a bonus layer has
    // somewhere to put its answer without overwriting the base. Nothing in this
    // file will ever make these two differ.
    total_cents: base
  };
}

/**
 * advisorComp({ secondsLogged, fundedCents }) — the funding advisor's pay.
 *
 *   $6.25/hr on logged time  +  0.25% of funded.
 *
 * Takes SECONDS, not hours: `advisorComp({ secondsLogged: secondsWorked(rows), fundedCents })`.
 * A decimal hours figure is a float, and a float must not be what a rate gets
 * multiplied by — see hoursWorked().
 *
 * Either input may be null/undefined, meaning "not known". That line's cents
 * and the total both come back null rather than 0. See knownCents().
 */
export function advisorComp({ secondsLogged, fundedCents } = {}) {
  const seconds = knownSeconds(secondsLogged, "advisorComp: secondsLogged");
  const funded = knownCents(fundedCents, "advisorComp: fundedCents");

  return breakdown("funding_advisor", [
    {
      key: "hourly",
      cents: seconds === null ? null : hourlyCents(seconds),
      basis: "seconds_logged",
      basis_value: seconds,
      rate_cents_per_hour: ADVISOR_HOURLY_RATE_CENTS
    },
    {
      key: "funded_percent",
      cents: funded === null ? null : percentOf(funded, FUNDED_PERCENT),
      basis: "funded_cents",
      basis_value: funded,
      percent: FUNDED_PERCENT
    }
  ]);
}

/**
 * closerComp({ depositsCents, fundedCents }) — the closer's pay.
 *
 *   $500 flat per $3K deposit  +  0.25% of funded.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  "$500 FLAT PER $3K DEPOSIT" IS AMBIGUOUS AND THIS REPOSITORY ALREADY   │
 * │     CONTAINS BOTH READINGS. A HUMAN HAS TO SETTLE IT.                     │
 * │                                                                            │
 * │ Reading A — PER WHOLE $3,000 BLOCK. $3,000 pays $500, $6,000 pays $1,000, │
 * │   $5,999 pays $500 (partial blocks do not pay). This is wholeUnits().     │
 * │                                                                            │
 * │ Reading B — ONE FLAT $500 PER SALE, once any deposit at or above $3,000   │
 * │   (or, as built, any non-zero deposit) has landed. It does not scale.     │
 * │                                                                            │
 * │ THIS FUNCTION IMPLEMENTS READING A, per its build instruction to match    │
 * │ wholeUnits().                                                             │
 * │                                                                            │
 * │ THE COMMISSION MODEL IMPLEMENTS READING B, and says so about this exact   │
 * │ sentence. src/commissions/calculate.mjs:84-89, case "flat":               │
 * │     "Fires once, whole, whenever the base is non-zero. '$500 per $3K      │
 * │      deposit' is this: one deposit, one $500 (CHRIS PROVISIONAL #1). It   │
 * │      does not scale with the size of the deposit."                        │
 * │ and src/commissions/commission-model-open-questions.md §1:                │
 * │     "### 1. `$500 flat per $3K deposit` — flat per sale ✅ … One deposit, │
 * │      one $500. Not per-unit." — answered by Chris on 2026-07-26, marked   │
 * │      CHRIS PROVISIONAL, pending Darwin's confirmation.                    │
 * │                                                                            │
 * │ SO THE TWO MODULES WILL DISAGREE ON A $6,000 DEPOSIT: this one says       │
 * │ $1,000, the commission engine says $500. That is not a bug to be patched  │
 * │ by whoever notices it first — it is one unanswered question with two      │
 * │ answers written down in two places, and the fix is a decision, not a      │
 * │ code change. Whoever settles it changes ONE of these and deletes the      │
 * │ other reading's comment. Until then, do not sum the two.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Either input may be null/undefined, meaning "not known" — see knownCents().
 */
export function closerComp({ depositsCents, fundedCents } = {}) {
  const deposits = knownCents(depositsCents, "closerComp: depositsCents");
  const funded = knownCents(fundedCents, "closerComp: fundedCents");

  // Reading A. wholeUnits() floors: $5,999 against a $3,000 unit is one unit,
  // not 1.99. See the box above before changing this line.
  const units = deposits === null ? null : wholeUnits(deposits, CLOSER_DEPOSIT_UNIT_CENTS);

  return breakdown("closer", [
    {
      key: "deposit_flat",
      cents: units === null ? null : units * CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS,
      basis: "deposits_cents",
      basis_value: deposits,
      units,
      unit_cents: CLOSER_DEPOSIT_UNIT_CENTS,
      flat_cents: CLOSER_FLAT_PER_DEPOSIT_UNIT_CENTS
    },
    {
      key: "funded_percent",
      cents: funded === null ? null : percentOf(funded, FUNDED_PERCENT),
      basis: "funded_cents",
      basis_value: funded,
      percent: FUNDED_PERCENT
    }
  ]);
}
