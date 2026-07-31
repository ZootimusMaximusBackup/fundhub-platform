// Timesheet. Logged time from shift rows — and nothing else.
//
// Pure: no clock, no I/O, no database. Shift rows come in as arguments; nothing
// here reads `shifts`. There is no money in this file and there must never be
// one again — see below.
//
// ── WHY THERE IS NO COMPENSATION MATH HERE ──────────────────────────────────
// This file used to export advisorComp() and closerComp(), along with the four
// rates they needed: $6.25/hr, 0.25% of funded, and a $500-per-$3,000-deposit
// flat. All seven are gone, deliberately, on 2026-07-31.
//
// Two separate reasons, and both matter:
//
//   1. THE COMMISSION RATES WERE A SECOND ANSWER TO A SETTLED QUESTION.
//      db/migrations/013_commission_rules.sql opens with "Every rate is a row.
//      There are no rates in code." src/commissions/calculate.mjs honours that
//      exactly — it holds no rate at all, taking percent / flat_amount /
//      per_unit_amount off commission_rules rows handed to it. This file held
//      constants for the same two rates and read the $500 differently:
//      wholeUnits() per $3,000 block, where calculate.mjs pays it once as a
//      plain `flat`. A $6,000 deposit was $1,000 here and $500 there. Nothing
//      called either function, so nothing was ever mispaid — but two payable
//      answers to one question is the defect, not the disagreement between
//      them. The rates live in commission_rules; the calculator is
//      src/commissions/calculate.mjs; this file has no business holding either.
//
//   2. THE HOURLY WAGE IS NOT MODELLED IN THIS SYSTEM AT ALL.
//      commission_rules cannot express it: `amount_basis` is a closed six-value
//      enum (sale_price, deposit_collected, cash_collected, amount_funded,
//      amount_approved, success_fee) with no hours basis, and 013 states that
//      enum is the one column on the table that is not admin-editable because
//      each value is a formula the calculator implements. An hourly wage is not
//      a commission and 013 was never built to hold one.
//      src/commissions/commission-model-open-questions.md §8 already says as
//      much — "$6.25/hr is payroll, not commission" — and puts it out of the
//      commission model's scope without putting it anywhere else. So it is
//      nowhere. That is the honest state, and $6.25 sitting in a constant here
//      dressed it up as modelled when it was not. Payroll needs its own home
//      before any code computes a wage; until someone builds one, this file
//      reports time and stops.
//
// What remains is the input payroll would need either way: how many seconds
// were actually logged. That is a real fact with a real source (the `shifts`
// table) and it is worth computing correctly whoever ends up multiplying it.
//
// ── ROUNDING RULE (decided here, stated once) ───────────────────────────────
// TIME IS NOT ROUNDED. Not to the quarter hour, not to the minute. Each shift
// contributes floor(milliseconds / 1000) whole seconds and the seconds are
// summed exactly.
//
// Why not the quarter hour, which is what payroll systems usually do: a
// rounding increment is an employment-policy decision with legal weight (it has
// to be neutral over time, and a system that rounds down on arrival and up on
// departure is a wage claim), and THERE IS NO SOURCE FOR ONE ANYWHERE IN THIS
// REPOSITORY — not in the schema, not in src/config/, not in any doc on disk.
// Rather than bake a policy nobody chose into every hour worked, this file
// rounds nothing and reports the seconds that were actually logged. If someone
// decides on an increment later it applies to secondsWorked() at one call site.
//
// Sub-second remainders are floored per shift rather than accumulated, so the
// total does not wobble with millisecond jitter in the timestamps.

// ── A SHIFT SOFTWARE GUESSED THE END OF IS NOT A TIMESHEET FACT ─────────────
// autoCloseStale() closes shifts nobody clocked out of, and when there is no
// recorded activity to end them at it falls back to started_at — a closed shift
// of zero length. Today that is EVERY forgotten shift belonging to anyone
// outside the Inquiry Remover desk, because no other screen writes telemetry.
//
// Read naively, that row says "this person worked no time". It is indis-
// tinguishable from a real 30-second shift on (started_at, ended_at) alone,
// which is why migration 068 puts `closed_by` on the row itself.
//
// This file refuses those rows rather than totalling them, for exactly the
// reason it already refuses a shift that ends before it starts: "quietly
// reporting it as zero hides the break from the only person who could fix it
// while still producing a plausible-looking timesheet." A wrong number that
// looks right is the failure mode; a loud one is not.
//
// `sweep_idle` — closed by the sweep but WITH activity behind the end time — is
// counted normally. It is an estimate, and it is the best evidence that exists,
// and it is not zero.
//
// ── WHAT THOSE SHIFTS ARE WORTH: DECIDED 2026-07-31 ─────────────────────────
// *** THE ONE ANSWER THAT IS NOT AVAILABLE IS ZERO. ***
//
// An employee clocked in, worked, and forgot to clock out. The employer's own
// record is what failed. Under the FLSA the employer carries the duty to keep
// accurate records of hours worked (29 CFR 516.2), and Anderson v. Mt. Clemens
// Pottery (1946) settles what happens when it does not: the employee need only
// show work was performed and produce enough to support a just and reasonable
// inference of the amount; the burden then sits with the employer to negate it,
// and approximate damages are awarded if it cannot. Paying nothing is the
// employer taking the benefit of its own record-keeping failure, which is the
// exact thing that rule exists to stop. A missed clock-out is a process failure
// to be handled as one — it is not a reason to withhold pay for time worked.
//
// Overpaying is also wrong and is separately refused: autoCloseStale() already
// declines to stamp now() as the end, because that credits every hour between
// the forgotten clock-out and whenever the sweep happened to run.
//
// So the estimate is drawn from THE PERSON'S OWN RECORD — the median length of
// their completed shifts. It is the best available inference about how long
// this individual actually works, it comes from data the system already holds,
// and it is neutral: it does not round toward the employer or the employee.
//
// A median, not a mean, because one forgotten shift already in the history (a
// real 30-second row) or one genuine 14-hour day would drag an average and a
// median shrugs both off.
//
// Bounded by `updated_at - started_at`. The sweep stamps updated_at when it
// closes the shift, so that is the moment the system observed the person as
// gone — they cannot have worked past it. The bound almost never binds (the
// sweep only fires after the idle threshold has already elapsed) and costs
// nothing to carry; it stops an absurd estimate if the threshold is ever set
// very low.
//
// AND THE ESTIMATE IS STILL FLAGGED. Every estimated shift comes back in
// needsReview so a human can correct it. The estimate is what gets paid if
// nobody looks; it is not a claim that anybody looked. Confirmed time and
// estimated time are reported as two separate numbers, always, so nobody can
// mistake one for the other — and payable time is their sum, because that is
// what has to be paid.
//
// NOT DECIDED HERE, because it is not this file's to decide: the rate. There is
// still no wage anywhere in this system. This file reports seconds and stops.

/** Seconds in an hour. Not money — named so hoursWorked() reads as a formula
 *  rather than as an unexplained 3600. */
export const SECONDS_PER_HOUR = 3600;

/** The `shifts.closed_by` value that means "software guessed, with nothing to
 *  guess from". Mirrors CLOSED_BY.SWEEP_NO_EVIDENCE in ./store.mjs; it is a
 *  string on a row rather than an import so this file stays pure and free of
 *  any dependency that could drag a database handle in behind it. */
export const UNRECONSTRUCTABLE = "sweep_no_evidence";

/**
 * needsReview(shift) — is this a shift whose end nobody can vouch for?
 *
 * True only for the no-evidence auto-close. An open shift is not "under review",
 * it is in progress; a human clock-out is not under review at all.
 */
export function needsReview(shift) {
  return !!shift && typeof shift === "object" && shift.closed_by === UNRECONSTRUCTABLE;
}

/** Milliseconds since epoch from a pg timestamptz (a Date) or an ISO string.
 *  A bare number is REFUSED: seconds and milliseconds are indistinguishable at
 *  a glance and guessing wrong is a factor-of-1000 error in someone's logged
 *  time. */
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
 * counting them up to "now" would make this function's answer depend on when it
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

  // Refused, not zeroed. See the header. This is the same call the negative-span
  // branch below makes, for the same reason: the caller must not be handed a
  // plausible number for a span nobody can vouch for. timesheet() partitions
  // these out before they ever reach here, so a throw means somebody totalled a
  // raw list and needs to know.
  if (needsReview(shift)) {
    throw new RangeError(
      `shiftSeconds: shift ${shift.id ?? "(no id)"} was auto-closed with no recorded activity, ` +
      `so ended_at is started_at and the span is unknowable, not zero. ` +
      `Use timesheet() to separate these, or have a human confirm the hours.`
    );
  }

  if (shift.ended_at === null || shift.ended_at === undefined) return 0;
  const endedAt = instantMs(shift.ended_at, "shiftSeconds: ended_at");

  const ms = endedAt - startedAt;
  if (ms < 0) {
    // Not clamped to zero. A shift that ends before it starts is a broken row,
    // and quietly reporting it as zero hides the break from the only person who
    // could fix it while still producing a plausible-looking timesheet.
    throw new RangeError(
      `shiftSeconds: shift ended before it started (started_at=${shift.started_at}, ended_at=${shift.ended_at})`
    );
  }
  return Math.floor(ms / 1000);
}

/**
 * secondsWorked(shifts) — total whole seconds logged across shift rows.
 *
 * THIS is the exact number. hoursWorked() below is the human-readable view of
 * the same fact. Anything that eventually pays for time should start here, in
 * whole seconds, not from a decimal hours figure.
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
 * FOR DISPLAY AND REPORTING. It is seconds / 3600, a repeating decimal for most
 * real timesheets, and a decimal number of hours multiplied by a rate is
 * exactly the float path this repository forbids. Returned unrounded on
 * purpose — see the rounding rule in the header: the time itself is not
 * rounded, so this function does not invent a precision either.
 */
export function hoursWorked(shifts) {
  return secondsWorked(shifts) / SECONDS_PER_HOUR;
}

/** The middle value, floored to whole seconds. Even counts average the two
 *  middle values; `Math.floor` keeps the result a whole second like every other
 *  span this file produces. Empty input is null — "no basis", not zero. */
function medianSeconds(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * estimateSeconds(shift, basis) — what an unvouchable shift is worth.
 *
 *   { seconds, method, sampleSize }
 *
 * `basis` is that person's completed shifts — the record the inference is drawn
 * from. Only closed, vouchable, non-zero shifts count toward it: an open shift
 * has no span yet, another unvouchable shift would be circular, and a zero-length
 * row is the very defect being repaired and must not become evidence for it.
 *
 * `method` is `own_median` when there was something to infer from, and `none`
 * when there was not — a first-day employee who forgot to clock out has no
 * record of their own. `none` returns 0 seconds and is NOT a claim that they
 * worked nothing: the shift stays flagged, and 0 is what an unanswered flag is
 * worth until a human answers it. Say so on any screen that shows it.
 *
 * Capped at `updated_at - started_at` when updated_at is present — the sweep
 * stamps it on closing, so it is the moment the person was observed gone.
 */
export function estimateSeconds(shift, basis = []) {
  if (!Array.isArray(basis)) {
    throw new TypeError(`estimateSeconds: expected an array for basis, got ${JSON.stringify(basis)}`);
  }
  const spans = [];
  for (const row of basis) {
    if (needsReview(row)) continue;                       // circular
    if (!row || row.ended_at === null || row.ended_at === undefined) continue;  // still open
    const s = shiftSeconds(row);
    if (s > 0) spans.push(s);                             // a zero row is the defect, not evidence
  }

  const median = medianSeconds(spans);
  if (median === null) return { seconds: 0, method: "none", sampleSize: 0 };

  let seconds = median;
  if (shift?.updated_at !== undefined && shift?.updated_at !== null) {
    const observedGoneMs = instantMs(shift.updated_at, "estimateSeconds: updated_at")
                         - instantMs(shift.started_at, "estimateSeconds: started_at");
    if (observedGoneMs >= 0) seconds = Math.min(seconds, Math.floor(observedGoneMs / 1000));
  }
  return { seconds, method: "own_median", sampleSize: spans.length };
}

/**
 * timesheet(shifts, { basis }) — the safe way to total a real, mixed list.
 *
 *   { seconds, hours, counted,
 *     estimatedSeconds, estimatedHours,
 *     payableSeconds, payableHours,
 *     needsReview: [{ shift, seconds, method, sampleSize }] }
 *
 * THREE NUMBERS, AND THE DIFFERENCE BETWEEN THEM IS THE POINT.
 *
 *   seconds          time somebody vouched for — human clock-outs, and sweep
 *                    closes that had recorded activity behind them.
 *   estimatedSeconds time inferred for shifts nobody can date the end of.
 *   payableSeconds   the two added up. THIS is what payroll uses, because a
 *                    shift the employer failed to record still has to be paid.
 *
 * They are separate so no screen and no downstream caller can show estimated
 * time as though somebody had checked it. A single figure would hide exactly the
 * thing a person needs to see.
 *
 * `basis` defaults to the same list — a person's own countable shifts. Pass a
 * longer history when you have one; a fortnight infers better than a week.
 *
 * `counted` is how many shifts fed the confirmed total, so a screen can say
 * "8 hours from 3 shifts, 1 estimated" rather than just "8 hours".
 */
export function timesheet(shifts, { basis } = {}) {
  if (!Array.isArray(shifts)) {
    throw new TypeError(`timesheet: expected an array of shift rows, got ${JSON.stringify(shifts)}`);
  }
  const review = [];
  const countable = [];
  for (const shift of shifts) (needsReview(shift) ? review : countable).push(shift);

  const seconds = secondsWorked(countable);
  const inferFrom = basis ?? countable;
  const estimates = review.map((shift) => ({ shift, ...estimateSeconds(shift, inferFrom) }));
  const estimatedSeconds = estimates.reduce((t, e) => t + e.seconds, 0);

  return {
    seconds,
    hours: seconds / SECONDS_PER_HOUR,
    counted: countable.length,
    estimatedSeconds,
    estimatedHours: estimatedSeconds / SECONDS_PER_HOUR,
    payableSeconds: seconds + estimatedSeconds,
    payableHours: (seconds + estimatedSeconds) / SECONDS_PER_HOUR,
    needsReview: estimates
  };
}
