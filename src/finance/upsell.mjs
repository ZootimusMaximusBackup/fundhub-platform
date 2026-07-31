// Upsell trigger evaluation — the part of the Finance OS that decides there is
// something worth saying about a client, and refuses to say it when it cannot.
//
// PURE. No clock, no database, no fetch, nothing that can differ between two runs
// on the same inputs. `now` is an argument. A rule whose answer depends on when
// it ran cannot be tested and cannot be audited, and this is a regulated
// consumer-finance product where "why did the system tell this person that" has
// to be answerable months later.
//
// THE THRESHOLDS ARE NOT IN THIS FILE. They arrive as `rules`, read from
// `upsell_trigger_rules` (079). There is not one number in this module that
// decides whether a condition fires. That is the repository's loudest rule —
// 013_commission_rules.sql:1, "Every rate is a row. There are no rates in code" —
// and it is the exact defect removed from src/shifts/timesheet.mjs on 2026-07-31,
// where four compensation constants gave a second, divergent answer to a question
// `commission_rules` already owned. A threshold in code here would do the same to
// a policy the 079 rows own.
//
// A MISSING INPUT IS NULL WITH A STATED REASON, NEVER A CONFIDENT ZERO.
// "Fundable for $X more" is a claim about somebody's credit. Every rule below
// returns `fires: false` and a sentence saying which input was absent rather than
// treating an unknown balance as zero or an unknown limit as no limit. This
// follows the reporting convention already in the repository — unmappedProducts()
// (src/entitlements/entitlements.mjs), unratedConversions()
// (src/affiliates/economics.mjs), needsAttention() (src/agents/registry.mjs) —
// which all keep a deliberate blank visible instead of filling it.
//
// MONEY IS INTEGER CENTS, via src/commissions/money.mjs. `percentOf` takes PERCENT
// UNITS (30 means 30%), matching `commission_rules.percent` and the 079 params.
// There is no float in any money path here: a utilization comparison is done by
// turning the ceiling into a cents figure and comparing cents to cents, not by
// dividing.
//
// ── WHAT THIS MODULE DOES NOT ANSWER ────────────────────────────────────────
// It does NOT compute how much a client can access. That is
// `calcFunding().totalAvailableCredit` in src/calculators/deal-funding.mjs, and a
// second implementation of it here is precisely the failure this file's header
// exists to avoid. `headroomCents()` below is the SAME definition expressed in
// integer cents — sum of max(0, limit − balance) over open drawable lines, cards
// with no limit excluded — and src/finance/upsell.test.mjs pins the two together
// against a shared fixture so they cannot drift apart unnoticed.
//
// ── WHAT THE SCHEMA CANNOT ANSWER, RECORDED HERE RATHER THAN GUESSED ────────
//   * `tradelines` (054) has NO opened date. Seasoning is therefore measurable
//     only for a line whose `opened_at` the caller supplies, and the rule reports
//     how many lines it could not age instead of assuming they qualify.
//   * `tradelines` keeps NO history — src/tradelines/store.mjs upserts in place,
//     so a new pull overwrites the old balance. "Utilization dropped" needs the
//     previous position as an argument. `crs_results` is per-pull history and
//     `normalizeFromCrs()` will re-read an older row into the same shape; making
//     that call is the caller's job, not this module's.
//   * "clean pull" has raw facts in the schema
//     (clients.custom_fields.crs_inquiries_ex / _eq / _tu, crs_late_payments_count)
//     but no definition of how many still counts as clean. That is a 079 row.

import { percentOf, roundHalfUp } from "../commissions/money.mjs";

/* The lines a client can actually draw against. Same two exclusions as
   toCalculatorCards() in src/tradelines/index.mjs, for the same reasons: a closed
   card has no headroom, and you cannot draw against an installment loan. */
export const DRAWABLE_KINDS = Object.freeze(["revolving", "loc"]);

/* Mirrors the $1bn guard in src/commissions/money.mjs. A total past this is a
   typo'd input, and a typo that silently produces garbage is worse than a throw. */
const MAX_TOTAL_CENTS = 100_000_000_000;

/* ── input readers ──────────────────────────────────────────────────────────
   All three follow the same contract: null/undefined/'' is a legitimate UNKNOWN
   and comes back as null; anything that is not a well-formed value of the right
   kind THROWS. Nothing here may quietly become NaN — a NaN that reaches a
   comparison makes every threshold false and the system goes quiet without
   anybody being told why. */

/* Only a number or a string may become a number. Without this, String([5]) is
   "5" and an array silently reads as five cents; String(true) and String({})
   happen to fail, so the hole would only show up on the one shape that matters. */
function numeric(value, label) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new TypeError(`${label}: expected a number or a numeric string, got ${typeOf(value)}`);
  }
  return typeof value === "number" ? value : Number(value.trim());
}

/** Integer cents off a row. pg returns bigint as a string, so strings are normal. */
export function centsOrNull(value, label = "value") {
  if (value === null || value === undefined || value === "") return null;
  const n = numeric(value, label);
  if (!Number.isFinite(n)) throw new TypeError(`${label}: not a number: ${JSON.stringify(value)}`);
  if (!Number.isInteger(n)) throw new TypeError(`${label}: cents must be a whole number: ${JSON.stringify(value)}`);
  if (n < 0) throw new RangeError(`${label}: cents must not be negative: ${n}`);
  if (n > MAX_TOTAL_CENTS) throw new RangeError(`${label}: out of range: ${n}`);
  return n;
}

/** A whole count off a row (inquiries, late payments, line counts). */
export function countOrNull(value, label = "count") {
  if (value === null || value === undefined || value === "") return null;
  const n = numeric(value, label);
  if (!Number.isFinite(n)) throw new TypeError(`${label}: not a number: ${JSON.stringify(value)}`);
  if (!Number.isInteger(n)) throw new TypeError(`${label}: must be a whole number: ${JSON.stringify(value)}`);
  if (n < 0) throw new RangeError(`${label}: must not be negative: ${n}`);
  return n;
}

/** A percent-unit threshold off a rule row: 30 means 30%. */
export function percentOrNull(value, label = "percent") {
  if (value === null || value === undefined || value === "") return null;
  const n = numeric(value, label);
  if (!Number.isFinite(n)) throw new TypeError(`${label}: not a number: ${JSON.stringify(value)}`);
  if (n <= 0 || n > 100) throw new RangeError(`${label}: must be a percent in (0, 100]: ${n}`);
  return n;
}

/** An APR as tradelines.apr stores it: a DECIMAL FRACTION in [0,1]. 0.2499 is
 *  24.99%. A value above 1 is refused rather than divided by 100 — a threshold
 *  row that meant 24.99% and said 24.99 must fail loudly, not quietly become
 *  2499% or quietly become 24.99% depending on which module read it. */
export function aprFractionOrNull(value, label = "apr") {
  if (value === null || value === undefined || value === "") return null;
  const n = numeric(value, label);
  if (!Number.isFinite(n)) throw new TypeError(`${label}: not a number: ${JSON.stringify(value)}`);
  if (n < 0 || n > 1) {
    throw new RangeError(`${label}: APR must be a decimal fraction in [0,1] — 0.2499 is 24.99% — got ${n}`);
  }
  return n;
}

/** A bureau score. The 0-1200 band is a TYPO GUARD, not a policy: it exists to
 *  catch a utilization percentage or a dollar amount arriving where a score
 *  belongs. Which scores matter is a threshold, and thresholds are rows. */
export function scoreOrNull(value, label = "score") {
  const n = countOrNull(value, label);
  if (n !== null && n > 1200) {
    throw new RangeError(`${label}: ${n} is not a plausible credit score — check the caller is not passing a percentage or an amount`);
  }
  return n;
}

/** A timestamp off a row or an argument. Invalid dates throw rather than becoming
 *  NaN-valued Dates, which compare false against everything in silence. */
export function dateOrNull(value, label = "timestamp") {
  if (value === null || value === undefined || value === "") return null;
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") {
    // new Date(["2026"]) is a valid 2026 date. Same hole as numeric() above.
    throw new TypeError(`${label}: expected a Date, an ISO string or epoch ms, got ${typeOf(value)}`);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new TypeError(`${label}: not a valid date: ${JSON.stringify(value)}`);
  }
  return d;
}

/* ── position, measured from the lines ──────────────────────────────────────── */

/** Open, drawable lines: not closed, not installment. */
export function openDrawableLines(tradelines) {
  if (!Array.isArray(tradelines)) {
    throw new TypeError(`openDrawableLines: tradelines must be an array, got ${typeOf(tradelines)}`);
  }
  return tradelines.filter((r) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new TypeError(`openDrawableLines: every tradeline must be an object, got ${typeOf(r)}`);
    }
    if (dateOrNull(r.closed_at, "tradeline.closed_at") !== null) return false;
    return DRAWABLE_KINDS.includes(String(r.kind ?? "revolving"));
  });
}

/**
 * headroomCents — total drawable headroom, in integer cents.
 *
 * THE SAME DEFINITION AS calcFunding().totalAvailableCredit, deliberately: cards
 * with no credit limit are excluded, a missing balance counts as zero, and each
 * card contributes max(0, limit − balance). Expressed in cents rather than
 * dollars because this side of the system multiplies and sums it.
 *
 * The permissive treatment of a missing balance is why NO RULE BELOW CALLS THIS
 * WITHOUT FIRST CALLING positionOf(): the arithmetic matches the calculator, and
 * the refusal to make a claim on incomplete data lives in the rule.
 */
export function headroomCents(tradelines) {
  let total = 0;
  for (const r of openDrawableLines(tradelines)) {
    const limit = centsOrNull(r.credit_limit_cents, "tradeline.credit_limit_cents");
    if (limit === null) continue;
    const balance = centsOrNull(r.balance_cents, "tradeline.balance_cents") ?? 0;
    total += Math.max(0, limit - balance);
  }
  if (total > MAX_TOTAL_CENTS) throw new RangeError(`headroomCents: total out of range: ${total}`);
  return total;
}

/**
 * positionOf — everything a claim needs, plus an explicit verdict on whether the
 * data supports making one.
 *
 * `complete` is false whenever ANY open drawable line is missing a limit or a
 * balance. An understated limit overstates utilization and an assumed-zero
 * balance overstates headroom; either produces a confident wrong number about
 * somebody's credit, which is the one output this module must never emit.
 */
export function positionOf(tradelines) {
  const lines = openDrawableLines(tradelines);
  const revolving = lines.filter((r) => String(r.kind ?? "revolving") === "revolving");

  let limitCents = 0;
  let balanceCents = 0;
  let missingLimit = 0;
  let missingBalance = 0;

  for (const r of lines) {
    const limit = centsOrNull(r.credit_limit_cents, "tradeline.credit_limit_cents");
    const balance = centsOrNull(r.balance_cents, "tradeline.balance_cents");
    if (limit === null) missingLimit += 1; else limitCents += limit;
    if (balance === null) missingBalance += 1; else balanceCents += balance;
  }
  if (limitCents > MAX_TOTAL_CENTS || balanceCents > MAX_TOTAL_CENTS) {
    throw new RangeError("positionOf: totals out of range");
  }

  const problems = [];
  if (!lines.length) problems.push("no open drawable credit lines");
  if (missingLimit) problems.push(`${missingLimit} open line(s) have no credit limit`);
  if (missingBalance) problems.push(`${missingBalance} open line(s) have no balance`);
  if (!missingLimit && lines.length && limitCents === 0) {
    problems.push("total credit limit is zero, so utilization is undefined");
  }

  const complete = problems.length === 0;
  // With no lines at all, the totals are UNKNOWN rather than zero. A client we
  // hold no lines for has not been shown to have no credit.
  const known = (missing, sum) => (lines.length === 0 ? null : missing ? null : sum);
  return {
    open_lines: lines.length,
    open_revolving_lines: revolving.length,
    total_limit_cents: known(missingLimit, limitCents),
    total_balance_cents: known(missingBalance, balanceCents),
    utilization_bp: complete ? utilizationBasisPoints(limitCents, balanceCents) : null,
    headroom_cents: complete ? headroomCents(tradelines) : null,
    complete,
    // Kept as a sentence rather than a code, because it is read by a person
    // deciding whether the blank is acceptable.
    incomplete_reason: complete ? null : problems.join("; ")
  };
}

/** Utilization in basis points (100 bp = 1 percentage point). A ratio, not money,
 *  so it is rounded once here and never fed back into a money path. */
export function utilizationBasisPoints(limitCents, balanceCents) {
  if (!Number.isInteger(limitCents) || !Number.isInteger(balanceCents)) {
    throw new TypeError("utilizationBasisPoints: limit and balance must be integer cents");
  }
  if (limitCents <= 0) return null;
  return roundHalfUp((balanceCents * 10000) / limitCents);
}

/**
 * additionalCapacityCents — how much MORE balance could be carried while staying
 * at or below the ceiling. Integer cents throughout: the ceiling is applied with
 * percentOf() from src/commissions/money.mjs, the same function the commission
 * calculator uses, so there is exactly one rounding rule in the codebase.
 */
export function additionalCapacityCents(limitCents, balanceCents, ceilingPct) {
  if (!Number.isInteger(limitCents) || !Number.isInteger(balanceCents)) {
    throw new TypeError("additionalCapacityCents: limit and balance must be integer cents");
  }
  return Math.max(0, percentOf(limitCents, ceilingPct) - balanceCents);
}

/**
 * monthsBetween — whole months from `from` to `to`, calendar months in UTC.
 *
 * Rounds DOWN whenever the day-of-month has not come round yet, so an age is
 * never overstated. Understating an age can only make a rule fail to fire;
 * overstating one could make it claim a line is seasoned when it is not.
 */
export function monthsBetween(from, to) {
  const a = dateOrNull(from, "monthsBetween.from");
  const b = dateOrNull(to, "monthsBetween.to");
  if (a === null || b === null) throw new TypeError("monthsBetween: both dates are required");
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

/* ── the conditions ─────────────────────────────────────────────────────────
   One function per rule_key in 079. Each takes the thresholds as `params` and
   returns { fires, reason, metrics }. None of them holds a number. */

export const UPSELL_RULES = {
  /* "Utilization dropped below X and the pull is clean" → fundable for $X more.
     Four things must all hold, and the absence of any one of them is reported
     rather than assumed:
       1. the previous position is known,
       2. both positions are complete enough to make a claim,
       3. utilization crossed the ceiling from above to at-or-below it,
       4. the latest pull is inside the clean-pull limits.
     The amount is then the INCREASE in drawable headroom — literally "more" than
     before — with the capacity-to-ceiling reported alongside it. */
  utilization_drop_clean_pull({ tradelines, previousTradelines, pull, params }) {
    const ceilingPct = percentOrNull(params.utilization_ceiling_pct, "utilization_ceiling_pct");
    const maxInquiries = countOrNull(params.clean_pull_max_inquiries_per_bureau, "clean_pull_max_inquiries_per_bureau");
    const maxLate = countOrNull(params.clean_pull_max_late_payments, "clean_pull_max_late_payments");
    const minDropBp = countOrNull(params.min_drop_basis_points, "min_drop_basis_points");

    const unset = [];
    if (ceilingPct === null) unset.push("utilization_ceiling_pct");
    if (maxInquiries === null) unset.push("clean_pull_max_inquiries_per_bureau");
    if (maxLate === null) unset.push("clean_pull_max_late_payments");
    if (unset.length) return unsetThresholds(unset);

    if (previousTradelines === null || previousTradelines === undefined) {
      return blank("no previous position supplied, so nothing can be said to have dropped — " +
        "tradelines are upserted in place and keep no history; re-read an older crs_results row " +
        "through normalizeFromCrs() to get one");
    }

    const now = positionOf(tradelines);
    const before = positionOf(previousTradelines);
    if (!before.complete) return blank(`the previous position is incomplete: ${before.incomplete_reason}`, { before });
    if (!now.complete) return blank(`the current position is incomplete: ${now.incomplete_reason}`, { now, before });

    const metrics = {
      utilization_bp_before: before.utilization_bp,
      utilization_bp_now: now.utilization_bp,
      utilization_ceiling_bp: roundHalfUp(ceilingPct * 100),
      total_limit_cents: now.total_limit_cents,
      total_balance_cents: now.total_balance_cents,
      headroom_cents_before: before.headroom_cents,
      headroom_cents_now: now.headroom_cents,
      headroom_increase_cents: now.headroom_cents - before.headroom_cents,
      additional_capacity_cents:
        additionalCapacityCents(now.total_limit_cents, now.total_balance_cents, ceilingPct)
    };

    // Cents to cents, never a division: the ceiling becomes a cents figure via the
    // same percentOf() the commission calculator uses.
    const ceilingCentsNow = percentOf(now.total_limit_cents, ceilingPct);
    const ceilingCentsBefore = percentOf(before.total_limit_cents, ceilingPct);
    const wasAbove = before.total_balance_cents > ceilingCentsBefore;
    const isAtOrBelow = now.total_balance_cents <= ceilingCentsNow;

    if (!wasAbove) {
      return blank(`utilization was already at or below the ${ceilingPct}% ceiling before this pull`, metrics);
    }
    if (!isAtOrBelow) {
      return blank(`utilization is still above the ${ceilingPct}% ceiling`, metrics);
    }

    const dropBp = metrics.utilization_bp_before - metrics.utilization_bp_now;
    if (minDropBp !== null && dropBp < minDropBp) {
      return blank(`utilization fell ${dropBp} basis points, under the ${minDropBp} required`, { ...metrics, drop_basis_points: dropBp });
    }

    if (metrics.headroom_increase_cents <= 0) {
      return blank("drawable headroom did not increase, so there is nothing more to draw", metrics);
    }

    const cleanliness = cleanPull(pull, { maxInquiries, maxLate });
    if (!cleanliness.known) return blank(cleanliness.reason, { ...metrics, ...cleanliness.metrics });
    if (!cleanliness.clean) return blank(cleanliness.reason, { ...metrics, ...cleanliness.metrics });

    return {
      fires: true,
      reason: `utilization fell from ${metrics.utilization_bp_before} to ${metrics.utilization_bp_now} basis points, ` +
        `crossing the ${ceilingPct}% ceiling, on a pull inside the clean-pull limits`,
      metrics: { ...metrics, drop_basis_points: dropBp, ...cleanliness.metrics }
    };
  },

  /* Seasoned lines → line-of-credit or refinance candidate.
     BLOCKED ON SCHEMA as well as on numbers: 054 stores no opened date. A line
     whose age is unknown is counted as unknown, never as seasoned. If enough
     lines are provably seasoned the answer is solid regardless of the unknowns,
     which is why the unknown count only blocks a NEGATIVE result. */
  seasoned_tradelines({ tradelines, params, now }) {
    const minAgeMonths = countOrNull(params.min_age_months, "min_age_months");
    const minSeasoned = countOrNull(params.min_seasoned_lines, "min_seasoned_lines");

    const unset = [];
    if (minAgeMonths === null) unset.push("min_age_months");
    if (minSeasoned === null) unset.push("min_seasoned_lines");
    if (unset.length) return unsetThresholds(unset);

    if (now === null) return blank("no evaluation time supplied, and an age cannot be measured without one");

    const lines = openDrawableLines(tradelines);
    let seasoned = 0;
    let unaged = 0;
    const ages = [];
    for (const r of lines) {
      const opened = dateOrNull(r.opened_at, "tradeline.opened_at");
      if (opened === null) { unaged += 1; continue; }
      const age = monthsBetween(opened, now);
      ages.push(age);
      if (age >= minAgeMonths) seasoned += 1;
    }

    const metrics = {
      open_lines: lines.length,
      seasoned_lines: seasoned,
      lines_with_no_opened_date: unaged,
      min_age_months: minAgeMonths,
      ages_months: ages
    };

    if (seasoned >= minSeasoned) {
      return {
        fires: true,
        reason: `${seasoned} open line(s) are at least ${minAgeMonths} months old, meeting the threshold of ${minSeasoned}`,
        metrics
      };
    }
    if (unaged > 0) {
      return blank(
        `only ${seasoned} line(s) could be shown to be seasoned and ${unaged} carry no opened date — ` +
        "tradelines (054) has no opened_at column, so their age is unknown rather than young",
        metrics
      );
    }
    return blank(`only ${seasoned} of ${lines.length} open line(s) are at least ${minAgeMonths} months old, under the threshold of ${minSeasoned}`, metrics);
  },

  /* Strength signals → second-entity candidate. All three thresholds must be met
     at once; nothing here decides what a strength signal is, only whether the
     measured ones clear the row's numbers. */
  strength_signals({ tradelines, params }) {
    const minLimitCents = centsOrNull(params.min_total_limit_cents, "min_total_limit_cents");
    const minRevolving = countOrNull(params.min_open_revolving_lines, "min_open_revolving_lines");
    const maxUtilPct = percentOrNull(params.max_utilization_pct, "max_utilization_pct");

    const unset = [];
    if (minLimitCents === null) unset.push("min_total_limit_cents");
    if (minRevolving === null) unset.push("min_open_revolving_lines");
    if (maxUtilPct === null) unset.push("max_utilization_pct");
    if (unset.length) return unsetThresholds(unset);

    const position = positionOf(tradelines);
    if (!position.complete) return blank(`the position is incomplete: ${position.incomplete_reason}`, position);

    const metrics = {
      total_limit_cents: position.total_limit_cents,
      total_balance_cents: position.total_balance_cents,
      open_revolving_lines: position.open_revolving_lines,
      utilization_bp: position.utilization_bp,
      max_utilization_bp: roundHalfUp(maxUtilPct * 100)
    };

    const shortfalls = [];
    if (position.total_limit_cents < minLimitCents) {
      shortfalls.push(`total limit ${position.total_limit_cents} cents is under ${minLimitCents}`);
    }
    if (position.open_revolving_lines < minRevolving) {
      shortfalls.push(`${position.open_revolving_lines} open revolving line(s), under ${minRevolving}`);
    }
    if (position.total_balance_cents > percentOf(position.total_limit_cents, maxUtilPct)) {
      shortfalls.push(`utilization ${position.utilization_bp} bp is above the ${maxUtilPct}% ceiling`);
    }
    if (shortfalls.length) return blank(shortfalls.join("; "), metrics);

    return {
      fires: true,
      reason: `total limit, open revolving line count and utilization all clear their thresholds`,
      metrics
    };
  },

  /* The score rose enough to revisit funding.
     TWO READINGS ARE REQUIRED. A gain cannot be measured from one number, and
     "we only have today's score" is not "the score did not move". Unlike the
     tradeline position, both readings genuinely exist on disk: `snapshots` keeps
     one row per pull with a `score` column. */
  score_improvement({ params, scores }) {
    const minGain = countOrNull(params.min_score_gain, "min_score_gain");
    const minScore = scoreOrNull(params.min_score, "min_score");

    const unset = [];
    if (minGain === null) unset.push("min_score_gain");
    if (minScore === null) unset.push("min_score");
    if (unset.length) return unsetThresholds(unset);

    const previous = scoreOrNull(scores?.previous, "scores.previous");
    const current = scoreOrNull(scores?.current, "scores.current");
    if (current === null) return blank("no current credit score supplied");
    if (previous === null) {
      return blank("no previous credit score supplied — a gain cannot be measured from a single reading", { score_now: current });
    }

    const gain = current - previous;
    const metrics = { score_before: previous, score_now: current, score_gain: gain,
                      min_score_gain: minGain, min_score: minScore };

    if (current < minScore) return blank(`the score is ${current}, under the ${minScore} required`, metrics);
    if (gain < minGain) return blank(`the score gained ${gain} point(s), under the ${minGain} required`, metrics);

    return { fires: true, reason: `the score rose ${gain} point(s) to ${current}`, metrics };
  },

  /* A card expensive enough to be worth replacing.
     AN UNKNOWN APR IS UNPRICED, NEVER CHEAP. 054's own header makes the same
     point about the funding waterfall: a card with no rate must not be treated
     as the cheapest money available. Here the direction is reversed and the rule
     is the same — a card whose rate we do not know is not evidence that the
     client has nothing expensive. */
  card_upgrade_candidate({ tradelines, params }) {
    const aprFloor = aprFractionOrNull(params.apr_at_or_above, "apr_at_or_above");
    const minBalance = centsOrNull(params.min_balance_cents, "min_balance_cents");

    const unset = [];
    if (aprFloor === null) unset.push("apr_at_or_above");
    if (minBalance === null) unset.push("min_balance_cents");
    if (unset.length) return unsetThresholds(unset);

    const lines = openDrawableLines(tradelines).filter((r) => String(r.kind ?? "revolving") === "revolving");
    const candidates = [];
    let unpriced = 0;
    let unknownBalance = 0;

    for (const r of lines) {
      const apr = aprFractionOrNull(r.apr, "tradeline.apr");
      const balance = centsOrNull(r.balance_cents, "tradeline.balance_cents");
      if (apr === null) { unpriced += 1; continue; }
      if (balance === null) { unknownBalance += 1; continue; }
      if (apr < aprFloor || balance < minBalance) continue;
      candidates.push({
        id: r.id ?? null,
        lender: r.lender ?? null,
        apr,
        balance_cents: balance,
        // Simple annual interest on TODAY'S balance at TODAY'S rate. Not a
        // projection of what the client will pay — payments move the balance —
        // and labelled that way so nobody quotes it as one. roundHalfUp keeps it
        // on a whole cent; percentOf is not used because its input is percent
        // units and converting a fraction into them adds a float round-trip for
        // no gain.
        interest_at_current_balance_cents: roundHalfUp(balance * apr)
      });
    }

    // Cheapest-money-last: the most expensive card is the one worth replacing.
    candidates.sort((a, b) => b.apr - a.apr || b.balance_cents - a.balance_cents);

    const metrics = {
      open_revolving_lines: lines.length,
      candidates,
      lines_with_no_apr: unpriced,
      lines_with_no_balance: unknownBalance,
      apr_at_or_above: aprFloor,
      min_balance_cents: minBalance
    };

    if (candidates.length) {
      return {
        fires: true,
        reason: `${candidates.length} open revolving line(s) carry an APR at or above ${aprFloor} on a balance of at least ${minBalance} cents`,
        metrics
      };
    }
    if (unpriced || unknownBalance) {
      return blank(
        `no line could be shown to qualify, and ${unpriced} line(s) have no APR and ${unknownBalance} have no balance — ` +
        "a card whose rate is unknown is unpriced, not cheap",
        metrics
      );
    }
    return blank(`no open revolving line reaches an APR of ${aprFloor} on a balance of ${minBalance} cents`, metrics);
  }
};

/* ── the four named entry points ────────────────────────────────────────────
   Thin, deliberately. Each is the rule function under its public name, so a
   caller that wants one condition does not have to build a rules map and read
   an array back. There is exactly one implementation of each condition; these
   are names for it, not second copies of it. */

/** "Utilization dropped and the pull is clean" → fundable for $X more. */
export const evaluateUtilization = (opts = {}) => UPSELL_RULES.utilization_drop_clean_pull(withParams(opts));

/** "The score rose enough to revisit funding." */
export const evaluateScore = (opts = {}) => UPSELL_RULES.score_improvement(withParams(opts));

/** "This card is expensive enough to be worth replacing." */
export const suggestCardUpgrade = (opts = {}) => UPSELL_RULES.card_upgrade_candidate(withParams(opts));

function withParams(opts) {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new TypeError(`expected an options object, got ${typeOf(opts)}`);
  }
  const params = opts.params ?? {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError(`params must be an object, got ${typeOf(params)}`);
  }
  return { tradelines: [], previousTradelines: null, pull: null, scores: null, now: null, ...opts, params };
}

/* cleanPull — is the latest pull inside the limits the rule row sets?
   Reads the real column names from db/schema/005_client_custom_fields.sql. A
   bureau whose count is absent makes the answer UNKNOWN, not clean: "we have no
   figure for Equifax" is not evidence of a clean file. */
export function cleanPull(pull, { maxInquiries, maxLate }) {
  if (pull === null || pull === undefined) {
    return { known: false, clean: null, reason: "no pull figures supplied, so the pull cannot be called clean", metrics: {} };
  }
  if (typeof pull !== "object" || Array.isArray(pull)) {
    throw new TypeError(`cleanPull: pull must be an object, got ${typeOf(pull)}`);
  }

  const bureaus = {
    ex: countOrNull(pull.crs_inquiries_ex, "pull.crs_inquiries_ex"),
    eq: countOrNull(pull.crs_inquiries_eq, "pull.crs_inquiries_eq"),
    tu: countOrNull(pull.crs_inquiries_tu, "pull.crs_inquiries_tu")
  };
  const late = countOrNull(pull.crs_late_payments_count, "pull.crs_late_payments_count");

  const metrics = { inquiries_by_bureau: bureaus, late_payments: late };

  const missing = Object.entries(bureaus).filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    return { known: false, clean: null, metrics,
      reason: `inquiry count missing for ${missing.join(", ")} — an absent bureau figure is unknown, not clean` };
  }
  if (late === null) {
    return { known: false, clean: null, metrics,
      reason: "late-payment count is missing, so the pull cannot be called clean" };
  }

  const over = Object.entries(bureaus).filter(([, v]) => v > maxInquiries).map(([k, v]) => `${k}=${v}`);
  if (over.length) {
    return { known: true, clean: false, metrics,
      reason: `inquiries over the limit of ${maxInquiries}: ${over.join(", ")}` };
  }
  if (late > maxLate) {
    return { known: true, clean: false, metrics,
      reason: `${late} late payment(s), over the limit of ${maxLate}` };
  }
  return { known: true, clean: true, metrics, reason: "pull is within the clean-pull limits" };
}

/* ── the evaluator ──────────────────────────────────────────────────────────── */

/**
 * evaluate — run every rule ROW against one client's lines.
 *
 * Iterates the ROWS, not the implemented functions, so that a row naming a
 * condition no function implements is REPORTED rather than silently skipped; and
 * then reports any implemented condition that has no row, because a condition
 * nobody has configured is a gap somebody should see, not a feature that is off.
 *
 * @param {object}  opts
 * @param {string?} opts.clientId          carried through onto the results; never read
 * @param {Array}   opts.tradelines        rows shaped like `tradelines` (054)
 * @param {Array?}  opts.previousTradelines the same shape, from an earlier pull
 * @param {object?} opts.pull              crs_inquiries_ex/_eq/_tu, crs_late_payments_count
 * @param {object?} opts.scores            { previous, current } — from `snapshots.score`
 * @param {object}  opts.rules             { rule_key: { active, needs_config, severity, params } }
 * @param {Date|string?} opts.now          evaluation time; there is no clock in here
 */
export function evaluate({
  clientId = null,
  tradelines = [],
  previousTradelines = null,
  pull = null,
  scores = null,
  rules = {},
  now = null
} = {}) {
  if (!Array.isArray(tradelines)) {
    throw new TypeError(`evaluate: tradelines must be an array, got ${typeOf(tradelines)}`);
  }
  if (previousTradelines !== null && previousTradelines !== undefined && !Array.isArray(previousTradelines)) {
    throw new TypeError(`evaluate: previousTradelines must be an array or null, got ${typeOf(previousTradelines)}`);
  }
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
    throw new TypeError(`evaluate: rules must be an object of rule rows, got ${typeOf(rules)}`);
  }
  const at = dateOrNull(now, "evaluate.now");
  const evaluatedAt = at === null ? null : at.toISOString();

  const results = [];
  for (const ruleKey of Object.keys(rules)) {
    const rule = rules[ruleKey];
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      throw new TypeError(`evaluate: rule "${ruleKey}" must be a rule row object, got ${typeOf(rule)}`);
    }
    const params = rule.params ?? {};
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new TypeError(`evaluate: rule "${ruleKey}".params must be an object, got ${typeOf(params)}`);
    }

    if (rule.active !== true) {
      results.push(finish(ruleKey, rule, evaluatedAt, blank(
        rule.needs_config === true
          ? "rule is inactive and still needs its thresholds decided"
          : "rule is inactive"
      ), params));
      continue;
    }

    const fn = Object.prototype.hasOwnProperty.call(UPSELL_RULES, ruleKey) ? UPSELL_RULES[ruleKey] : null;
    if (!fn) {
      results.push(finish(ruleKey, rule, evaluatedAt, blank(
        `no evaluator implements rule_key "${ruleKey}" — the condition is a formula in code, ` +
        "so a new key needs a function as well as a row"
      ), params));
      continue;
    }

    results.push(finish(ruleKey, rule, evaluatedAt,
      fn({ tradelines, previousTradelines, pull, scores, params, now: at }), params));
  }

  for (const ruleKey of Object.keys(UPSELL_RULES).sort()) {
    if (Object.prototype.hasOwnProperty.call(rules, ruleKey)) continue;
    results.push(finish(ruleKey, { severity: null }, evaluatedAt, blank(
      `no upsell_trigger_rules row for "${ruleKey}" — nothing decides when this condition fires`
    ), {}));
  }

  return results.map((r) => ({ ...r, client_id: clientId }));
}

/** The subset of results that should become `alerts` rows (078). */
export function firedAlerts(results) {
  if (!Array.isArray(results)) throw new TypeError("firedAlerts: results must be an array");
  return results.filter((r) => r.fires).map((r) => r.alert);
}

/** The deliberate blanks, kept visible. Same convention as unmappedProducts() and
 *  unratedConversions(): the gap is a reported row, not a silent absence. */
export function blanksOf(results) {
  if (!Array.isArray(results)) throw new TypeError("blanksOf: results must be an array");
  return results.filter((r) => !r.fires).map((r) => ({
    rule_key: r.rule_key,
    reason: r.reason,
    metrics: r.metrics
  }));
}

/* ── internals ─────────────────────────────────────────────────────────────── */

const blank = (reason, metrics = {}) => ({ fires: false, reason, metrics });

const unsetThresholds = (keys) => blank(
  `threshold(s) not set: ${keys.join(", ")} — a condition with no number does not fire, ` +
  "it does not fire on a guessed one"
);

function finish(ruleKey, rule, evaluatedAt, outcome, params) {
  const severity = rule.severity ?? null;
  return {
    rule_key: ruleKey,
    fires: outcome.fires === true,
    severity: outcome.fires === true ? severity : null,
    reason: outcome.reason,
    metrics: outcome.metrics ?? {},
    alert: outcome.fires === true
      ? {
          kind: ruleKey,
          severity,
          payload: {
            reason: outcome.reason,
            metrics: outcome.metrics ?? {},
            // Frozen, for the reason affiliate_referrals freezes its rule
            // snapshot: a threshold edited next month must not restate why an
            // alert fired last month.
            rule_snapshot: params,
            evaluated_at: evaluatedAt
          }
        }
      : null
  };
}

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export default evaluate;
