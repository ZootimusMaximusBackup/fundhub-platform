// Upsell rule tests — the thresholds, their off-by-one neighbours, the missing
// inputs, and the garbage.
//
// Three things these tests are built to prove, in order of how expensive getting
// them wrong would be:
//
//   1. NO THRESHOLD LIVES IN THE MODULE. Every "does it fire" test is run twice
//      with two different rule rows over identical lines, and the answers differ.
//      A constant smuggled into upsell.mjs would make both runs agree, and the
//      pair would fail. That is the defect removed from src/shifts/timesheet.mjs
//      on 2026-07-31, caught structurally rather than by reading.
//
//   2. A MISSING INPUT NEVER BECOMES A NUMBER. Every absent limit, absent
//      balance, absent opened date, absent bureau count and absent previous
//      position is asserted to produce fires:false WITH a reason naming the
//      absence — not a zero, not an estimate, not silence.
//
//   3. GARBAGE THROWS. "abc" as a balance, {} as a percent, an array where a
//      rule row belongs. NaN reaching a comparison makes every threshold false
//      and the system goes quiet with nobody told why, so these must be loud.
//
// There is also one test that is not about this module at all: headroomCents()
// is pinned to calcFunding().totalAvailableCredit over a shared fixture, so the
// integer-cents restatement and the dollars original cannot drift apart. Two
// answers to "how much is available" is the failure the whole file avoids.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  evaluate, firedAlerts, blanksOf,
  centsOrNull, countOrNull, percentOrNull, dateOrNull,
  openDrawableLines, positionOf, headroomCents,
  utilizationBasisPoints, additionalCapacityCents, monthsBetween,
  cleanPull, UPSELL_RULES, DRAWABLE_KINDS,
  evaluateUtilization, evaluateScore, suggestCardUpgrade,
  aprFractionOrNull, scoreOrNull
} from "./upsell.mjs";
import { calcFunding } from "../calculators/deal-funding.mjs";
import { toCalculatorCards } from "../tradelines/index.mjs";

/* A tradeline row as 054 stores it. Cents, APR as a fraction. */
const line = (over = {}) => ({
  id: "tl-1", lender: "Amex Blue Business", kind: "revolving",
  credit_limit_cents: 1_000_000, balance_cents: 400_000, apr: 0.1899,
  closed_at: null, ...over
});

const rule = (params, over = {}) => ({
  active: true, needs_config: false, severity: "info", params, ...over
});

const CLEAN = { crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 0, crs_late_payments_count: 0 };

const byKey = (results, key) => results.find((r) => r.rule_key === key);

/* ───────────────────────────── input readers ───────────────────────────── */

describe("the input readers turn absence into null and garbage into a throw", () => {
  test("centsOrNull: null, undefined and empty string are all a legitimate unknown", () => {
    for (const v of [null, undefined, ""]) assert.strictEqual(centsOrNull(v), null);
  });

  test("centsOrNull accepts the string a bigint column actually returns", () => {
    assert.strictEqual(centsOrNull("1800000"), 1_800_000);
    assert.strictEqual(centsOrNull(" 1800000 "), 1_800_000);
  });

  test("centsOrNull refuses a fractional cent rather than rounding one into existence", () => {
    assert.throws(() => centsOrNull(1.5), TypeError);
    assert.throws(() => centsOrNull("1.5"), TypeError);
  });

  test("centsOrNull throws on garbage instead of producing NaN", () => {
    // [5] is the one that matters: String([5]) is "5", so without a type guard a
    // one-element array reads as five cents and nothing anywhere complains.
    for (const v of ["abc", {}, [], [5], true, false, NaN, Infinity]) {
      assert.throws(() => centsOrNull(v, "balance"), (e) => e instanceof TypeError, `should throw for ${JSON.stringify(v)}`);
    }
  });

  test("dateOrNull refuses a one-element array, which new Date() would happily accept", () => {
    assert.throws(() => dateOrNull(["2026"]), TypeError);
    assert.throws(() => dateOrNull({}), TypeError);
  });

  test("centsOrNull refuses a negative amount and an amount past the $1bn guard", () => {
    assert.throws(() => centsOrNull(-1), RangeError);
    assert.throws(() => centsOrNull(100_000_000_001), RangeError);
    assert.strictEqual(centsOrNull(100_000_000_000), 100_000_000_000);
  });

  test("countOrNull takes whole counts only", () => {
    assert.strictEqual(countOrNull(null), null);
    assert.strictEqual(countOrNull(0), 0);
    assert.strictEqual(countOrNull("3"), 3);
    assert.throws(() => countOrNull(2.5), TypeError);
    assert.throws(() => countOrNull("two"), TypeError);
    assert.throws(() => countOrNull(-1), RangeError);
  });

  test("percentOrNull holds a percent-unit threshold inside (0, 100]", () => {
    assert.strictEqual(percentOrNull(null), null);
    assert.strictEqual(percentOrNull(30), 30);
    assert.strictEqual(percentOrNull("29.5"), 29.5);
    assert.strictEqual(percentOrNull(100), 100);
    assert.throws(() => percentOrNull(0), RangeError);
    assert.throws(() => percentOrNull(100.01), RangeError);
    assert.throws(() => percentOrNull("thirty"), TypeError);
  });

  test("dateOrNull refuses an unparseable date rather than returning an Invalid Date", () => {
    assert.strictEqual(dateOrNull(null), null);
    assert.strictEqual(dateOrNull("2026-07-31T00:00:00Z").toISOString(), "2026-07-31T00:00:00.000Z");
    assert.throws(() => dateOrNull("not a date"), TypeError);
    assert.throws(() => dateOrNull(new Date("nope")), TypeError);
  });
});

/* ─────────────────────────── lines and position ─────────────────────────── */

describe("only open, drawable lines count", () => {
  test("the drawable kinds are revolving and loc, and installment is not one of them", () => {
    assert.deepStrictEqual([...DRAWABLE_KINDS], ["revolving", "loc"]);
  });

  test("a closed card and an installment loan are both excluded", () => {
    const rows = [
      line({ id: "open" }),
      line({ id: "closed", closed_at: "2026-01-01T00:00:00Z" }),
      line({ id: "auto", kind: "installment" }),
      line({ id: "loc", kind: "loc" })
    ];
    assert.deepStrictEqual(openDrawableLines(rows).map((r) => r.id), ["open", "loc"]);
  });

  test("a non-array and a non-object row throw rather than being skipped", () => {
    assert.throws(() => openDrawableLines("nope"), TypeError);
    assert.throws(() => openDrawableLines([null]), TypeError);
    assert.throws(() => openDrawableLines(["a string"]), TypeError);
  });
});

describe("positionOf reports what is known and names what is not", () => {
  test("a complete set gives totals, utilization and headroom", () => {
    const p = positionOf([
      line({ credit_limit_cents: 1_000_000, balance_cents: 400_000 }),
      line({ id: "b", credit_limit_cents: 1_000_000, balance_cents: 200_000 })
    ]);
    assert.strictEqual(p.complete, true);
    assert.strictEqual(p.total_limit_cents, 2_000_000);
    assert.strictEqual(p.total_balance_cents, 600_000);
    assert.strictEqual(p.utilization_bp, 3000);          // 30.00%
    assert.strictEqual(p.headroom_cents, 1_400_000);
    assert.strictEqual(p.incomplete_reason, null);
  });

  test("no lines at all means unknown totals, not zero ones", () => {
    const p = positionOf([]);
    assert.strictEqual(p.complete, false);
    assert.strictEqual(p.total_limit_cents, null, "a client we hold no lines for has not been shown to have no credit");
    assert.strictEqual(p.total_balance_cents, null);
    assert.strictEqual(p.utilization_bp, null);
    assert.strictEqual(p.headroom_cents, null);
    assert.match(p.incomplete_reason, /no open drawable credit lines/);
  });

  test("one line with no limit blocks the claim and says how many", () => {
    const p = positionOf([line(), line({ id: "b", credit_limit_cents: null })]);
    assert.strictEqual(p.complete, false);
    assert.strictEqual(p.total_limit_cents, null);
    assert.match(p.incomplete_reason, /1 open line\(s\) have no credit limit/);
  });

  test("one line with no balance blocks the claim, and the balance is not assumed to be zero", () => {
    const p = positionOf([line(), line({ id: "b", balance_cents: null })]);
    assert.strictEqual(p.complete, false);
    assert.strictEqual(p.total_balance_cents, null);
    assert.strictEqual(p.total_limit_cents, 2_000_000, "the limit is still known and is still reported");
    assert.match(p.incomplete_reason, /1 open line\(s\) have no balance/);
  });

  test("a total limit of zero is reported as undefined utilization, not as 0%", () => {
    const p = positionOf([line({ credit_limit_cents: 0, balance_cents: 0 })]);
    assert.strictEqual(p.complete, false);
    assert.match(p.incomplete_reason, /total credit limit is zero/);
    assert.strictEqual(p.utilization_bp, null);
  });
});

describe("the arithmetic is integer cents and has exactly one definition", () => {
  test("headroomCents agrees with calcFunding().totalAvailableCredit on the same lines", () => {
    // The pin. If either side changes its definition of available credit, this
    // fails — which is the whole point of having it.
    const rows = [
      line({ id: "a", credit_limit_cents: 1_800_000, balance_cents: 820_000, apr: 0.1699 }),
      line({ id: "b", kind: "loc", credit_limit_cents: 1_500_000, balance_cents: 400_000, apr: 0.1499 }),
      line({ id: "c", credit_limit_cents: 1_200_000, balance_cents: 1_500_000, apr: 0.2499 }), // over limit
      line({ id: "d", kind: "installment", credit_limit_cents: 3_000_000, balance_cents: 0 }),
      line({ id: "e", closed_at: "2026-01-01T00:00:00Z", credit_limit_cents: 900_000, balance_cents: 0 })
    ];
    const cents = headroomCents(rows);
    const dollars = calcFunding({ cards: toCalculatorCards(rows) }).totalAvailableCredit;
    assert.strictEqual(cents, Math.round(dollars * 100),
      "the integer-cents restatement and the calculator must be the same number");
  });

  test("a card that is over its limit contributes zero headroom, never a negative", () => {
    assert.strictEqual(headroomCents([line({ credit_limit_cents: 100_000, balance_cents: 250_000 })]), 0);
  });

  test("a card with no limit is excluded from headroom, matching the calculator", () => {
    assert.strictEqual(headroomCents([line({ credit_limit_cents: null })]), 0);
  });

  test("utilization is basis points, rounded once, and undefined on a zero limit", () => {
    assert.strictEqual(utilizationBasisPoints(1_000_000, 300_000), 3000);
    assert.strictEqual(utilizationBasisPoints(300_000, 100_000), 3333);   // 33.333% -> 3333 bp
    assert.strictEqual(utilizationBasisPoints(0, 0), null);
    assert.throws(() => utilizationBasisPoints(1.5, 0), TypeError);
  });

  test("additional capacity is the ceiling in cents minus the balance, and never negative", () => {
    assert.strictEqual(additionalCapacityCents(1_000_000, 200_000, 30), 100_000);
    assert.strictEqual(additionalCapacityCents(1_000_000, 300_000, 30), 0, "exactly at the ceiling leaves nothing");
    assert.strictEqual(additionalCapacityCents(1_000_000, 900_000, 30), 0, "already over leaves nothing, not a negative");
    // A fractional percent still lands on a whole cent.
    assert.strictEqual(additionalCapacityCents(333_333, 0, 29.5), 98_333);
    assert.ok(Number.isInteger(additionalCapacityCents(333_333, 0, 29.5)));
  });
});

describe("monthsBetween counts whole calendar months and never overstates an age", () => {
  test("a line opened on the same day-of-month is exactly N months old", () => {
    assert.strictEqual(monthsBetween("2025-07-15T00:00:00Z", "2026-07-15T00:00:00Z"), 12);
  });

  test("one day short of the anniversary is one month less", () => {
    assert.strictEqual(monthsBetween("2025-07-15T00:00:00Z", "2026-07-14T23:59:59Z"), 11);
  });

  test("the day after the anniversary is still N months, not N+1", () => {
    assert.strictEqual(monthsBetween("2025-07-15T00:00:00Z", "2026-07-16T00:00:00Z"), 12);
  });

  test("a date in the future is negative rather than clamped to zero", () => {
    assert.strictEqual(monthsBetween("2026-08-01T00:00:00Z", "2026-07-01T00:00:00Z"), -1);
  });

  test("both ends are required, and an unparseable one throws", () => {
    assert.throws(() => monthsBetween(null, "2026-07-01T00:00:00Z"), TypeError);
    assert.throws(() => monthsBetween("2026-07-01T00:00:00Z", "later"), TypeError);
  });
});

/* ───────────────────────────── the clean pull ───────────────────────────── */

describe("an absent bureau figure is unknown, not clean", () => {
  const limits = { maxInquiries: 2, maxLate: 0 };

  test("no pull at all cannot be called clean", () => {
    const out = cleanPull(null, limits);
    assert.strictEqual(out.known, false);
    assert.strictEqual(out.clean, null);
    assert.match(out.reason, /no pull figures supplied/);
  });

  test("a missing bureau count names the bureau and refuses to answer", () => {
    const out = cleanPull({ ...CLEAN, crs_inquiries_eq: null }, limits);
    assert.strictEqual(out.known, false);
    assert.match(out.reason, /inquiry count missing for eq/);
  });

  test("a missing late-payment count refuses to answer", () => {
    const out = cleanPull({ ...CLEAN, crs_late_payments_count: null }, limits);
    assert.strictEqual(out.known, false);
    assert.match(out.reason, /late-payment count is missing/);
  });

  test("exactly at the inquiry limit is clean; one over is not", () => {
    assert.strictEqual(cleanPull({ ...CLEAN, crs_inquiries_tu: 2 }, limits).clean, true);
    const over = cleanPull({ ...CLEAN, crs_inquiries_tu: 3 }, limits);
    assert.strictEqual(over.clean, false);
    assert.match(over.reason, /tu=3/);
  });

  test("exactly at the late-payment limit is clean; one over is not", () => {
    assert.strictEqual(cleanPull({ ...CLEAN, crs_late_payments_count: 0 }, limits).clean, true);
    assert.strictEqual(cleanPull({ ...CLEAN, crs_late_payments_count: 1 }, limits).clean, false);
  });

  test("a garbage count throws rather than comparing NaN", () => {
    assert.throws(() => cleanPull({ ...CLEAN, crs_inquiries_ex: "lots" }, limits), TypeError);
    assert.throws(() => cleanPull([1, 2, 3], limits), TypeError);
  });
});

/* ───────────────── rule 1: utilization drop + clean pull ───────────────── */

describe("utilization_drop_clean_pull only speaks when every input is present", () => {
  const before = [line({ credit_limit_cents: 1_000_000, balance_cents: 500_000 })];  // 50%
  const after = [line({ credit_limit_cents: 1_000_000, balance_cents: 250_000 })];   // 25%
  const params = {
    utilization_ceiling_pct: 30,
    min_drop_basis_points: null,
    clean_pull_max_inquiries_per_bureau: 2,
    clean_pull_max_late_payments: 0
  };
  const run = (over = {}) => UPSELL_RULES.utilization_drop_clean_pull({
    tradelines: after, previousTradelines: before, pull: CLEAN, params, ...over
  });

  test("it fires when utilization crosses the ceiling on a clean pull, and reports the money", () => {
    const out = run();
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.utilization_bp_before, 5000);
    assert.strictEqual(out.metrics.utilization_bp_now, 2500);
    assert.strictEqual(out.metrics.headroom_increase_cents, 250_000, "$2,500 more drawable than at the last pull");
    assert.strictEqual(out.metrics.additional_capacity_cents, 50_000, "$500 of room left under a 30% ceiling");
    assert.ok(Number.isInteger(out.metrics.headroom_increase_cents));
  });

  test("with no ceiling set it does not fire, and says the threshold is unset", () => {
    const out = run({ params: { ...params, utilization_ceiling_pct: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /threshold\(s\) not set: utilization_ceiling_pct/);
  });

  test("with no clean-pull limits set it does not fire, and names both", () => {
    const out = run({ params: {
      ...params, clean_pull_max_inquiries_per_bureau: null, clean_pull_max_late_payments: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /clean_pull_max_inquiries_per_bureau, clean_pull_max_late_payments/);
  });

  test("THE THRESHOLD IS THE ROW: the same lines answer differently under a different ceiling", () => {
    const at30 = run({ params: { ...params, utilization_ceiling_pct: 30 } });
    const at20 = run({ params: { ...params, utilization_ceiling_pct: 20 } });
    assert.strictEqual(at30.fires, true, "25% is under a 30% ceiling");
    assert.strictEqual(at20.fires, false, "25% is still over a 20% ceiling");
    assert.match(at20.reason, /still above the 20% ceiling/);
    assert.notStrictEqual(at30.metrics.additional_capacity_cents, at20.metrics.additional_capacity_cents);
  });

  test("no previous position means nothing can be said to have dropped", () => {
    const out = run({ previousTradelines: null });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /no previous position supplied/);
    assert.match(out.reason, /keep no history/, "the reason points at why, so nobody hunts for a bug");
  });

  test("an incomplete previous position blocks the claim and names the gap", () => {
    const out = run({ previousTradelines: [line({ balance_cents: null })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /previous position is incomplete/);
    assert.match(out.reason, /no balance/);
  });

  test("an incomplete current position blocks the claim rather than assuming a zero balance", () => {
    const out = run({ tradelines: [...after, line({ id: "x", balance_cents: null })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /current position is incomplete/);
  });

  test("BOUNDARY: exactly at the ceiling before means it never dropped below it", () => {
    const out = run({ previousTradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 300_000 })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /already at or below the 30% ceiling/);
  });

  test("BOUNDARY: one cent above the ceiling before, exactly at it now, fires", () => {
    const out = run({
      previousTradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 300_001 })],
      tradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 300_000 })]
    });
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.additional_capacity_cents, 0, "at the ceiling there is no room left, and that is stated as 0 not hidden");
  });

  test("BOUNDARY: one cent above the ceiling now does not fire", () => {
    const out = run({ tradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 300_001 })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /still above the 30% ceiling/);
  });

  test("BOUNDARY: a drop exactly equal to min_drop_basis_points fires; one basis point less does not", () => {
    const atLimit = run({ params: { ...params, min_drop_basis_points: 2500 } });
    assert.strictEqual(atLimit.fires, true);
    const under = run({ params: { ...params, min_drop_basis_points: 2501 } });
    assert.strictEqual(under.fires, false);
    assert.match(under.reason, /fell 2500 basis points, under the 2501 required/);
  });

  test("headroom that did not increase is not an upsell, however good the utilization looks", () => {
    // Balance fell but the limit fell further: utilization crossed the ceiling,
    // yet there is strictly less money available than before.
    const out = run({
      previousTradelines: [line({ credit_limit_cents: 2_000_000, balance_cents: 1_000_000 })], // 50%, $10k headroom
      tradelines: [line({ credit_limit_cents: 500_000, balance_cents: 100_000 })]              // 20%, $4k headroom
    });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /headroom did not increase/);
    assert.strictEqual(out.metrics.headroom_increase_cents, -600_000);
  });

  test("an unclean pull does not fire, and the reason says which bureau", () => {
    const out = run({ pull: { ...CLEAN, crs_inquiries_ex: 9 } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /inquiries over the limit of 2: ex=9/);
  });

  test("an unknown pull does not fire, and is not treated as clean", () => {
    const out = run({ pull: null });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /no pull figures supplied/);
  });

  test("a garbage threshold throws rather than silently never firing", () => {
    assert.throws(() => run({ params: { ...params, utilization_ceiling_pct: "thirty" } }), TypeError);
    assert.throws(() => run({ params: { ...params, utilization_ceiling_pct: 0 } }), RangeError);
    assert.throws(() => run({ params: { ...params, clean_pull_max_late_payments: -1 } }), RangeError);
  });

  test("a garbage balance on a line throws rather than becoming NaN", () => {
    assert.throws(() => run({ tradelines: [line({ balance_cents: "some" })] }), TypeError);
  });
});

/* ──────────────────────── rule 2: seasoned tradelines ──────────────────── */

describe("seasoned_tradelines cannot age a line the schema does not date", () => {
  const NOW = "2026-07-31T00:00:00Z";
  const params = { min_age_months: 24, min_seasoned_lines: 2 };
  const run = (over = {}) => UPSELL_RULES.seasoned_tradelines({
    tradelines: [], params, now: new Date(NOW), ...over
  });

  test("with no thresholds set it does not fire and names them", () => {
    const out = run({ params: { min_age_months: null, min_seasoned_lines: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /threshold\(s\) not set: min_age_months, min_seasoned_lines/);
  });

  test("two lines old enough fires", () => {
    const out = run({ tradelines: [
      line({ id: "a", opened_at: "2020-01-01T00:00:00Z" }),
      line({ id: "b", opened_at: "2021-01-01T00:00:00Z" })
    ] });
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.seasoned_lines, 2);
  });

  test("BOUNDARY: exactly min_age_months counts; one day short does not", () => {
    const exact = run({ tradelines: [
      line({ id: "a", opened_at: "2024-07-31T00:00:00Z" }),
      line({ id: "b", opened_at: "2024-07-31T00:00:00Z" })
    ] });
    assert.strictEqual(exact.metrics.ages_months[0], 24);
    assert.strictEqual(exact.fires, true);

    const short = run({ tradelines: [
      line({ id: "a", opened_at: "2024-08-01T00:00:00Z" }),
      line({ id: "b", opened_at: "2024-08-01T00:00:00Z" })
    ] });
    assert.strictEqual(short.metrics.ages_months[0], 23);
    assert.strictEqual(short.fires, false);
  });

  test("BOUNDARY: exactly min_seasoned_lines fires; one fewer does not", () => {
    const one = run({ tradelines: [
      line({ id: "a", opened_at: "2020-01-01T00:00:00Z" }),
      line({ id: "b", opened_at: "2026-06-01T00:00:00Z" })
    ] });
    assert.strictEqual(one.fires, false);
    assert.match(one.reason, /only 1 of 2 open line\(s\)/);
  });

  test("a line with no opened date is UNKNOWN, not young, and the reason says so", () => {
    const out = run({ tradelines: [
      line({ id: "a", opened_at: "2020-01-01T00:00:00Z" }),
      line({ id: "b" })   // no opened_at — which is every row 054 stores
    ] });
    assert.strictEqual(out.fires, false);
    assert.strictEqual(out.metrics.lines_with_no_opened_date, 1);
    assert.match(out.reason, /carry no opened date/);
    assert.match(out.reason, /054/, "the reason points at the schema gap rather than at the client");
  });

  test("enough provably-seasoned lines fires even when others cannot be aged", () => {
    const out = run({ tradelines: [
      line({ id: "a", opened_at: "2020-01-01T00:00:00Z" }),
      line({ id: "b", opened_at: "2020-01-01T00:00:00Z" }),
      line({ id: "c" })
    ] });
    assert.strictEqual(out.fires, true, "unknowns only block a negative answer, never a positive one");
  });

  test("THE THRESHOLD IS THE ROW: the same lines answer differently under a different age", () => {
    const rows = [
      line({ id: "a", opened_at: "2025-01-01T00:00:00Z" }),
      line({ id: "b", opened_at: "2025-01-01T00:00:00Z" })
    ];
    assert.strictEqual(run({ tradelines: rows, params: { min_age_months: 12, min_seasoned_lines: 2 } }).fires, true);
    assert.strictEqual(run({ tradelines: rows, params: { min_age_months: 24, min_seasoned_lines: 2 } }).fires, false);
  });

  test("without an evaluation time it refuses rather than reaching for a clock", () => {
    const out = run({ now: null, tradelines: [line({ opened_at: "2020-01-01T00:00:00Z" })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /no evaluation time supplied/);
  });

  test("an unparseable opened date throws rather than being counted as unknown", () => {
    assert.throws(() => run({ tradelines: [line({ opened_at: "whenever" })] }), TypeError);
  });
});

/* ───────────────────────── rule 3: strength signals ─────────────────────── */

describe("strength_signals needs all three thresholds and a complete position", () => {
  const strong = [
    line({ id: "a", credit_limit_cents: 2_000_000, balance_cents: 100_000 }),
    line({ id: "b", credit_limit_cents: 2_000_000, balance_cents: 100_000 }),
    line({ id: "c", credit_limit_cents: 2_000_000, balance_cents: 100_000 })
  ];
  const params = { min_total_limit_cents: 5_000_000, min_open_revolving_lines: 3, max_utilization_pct: 30 };
  const run = (over = {}) => UPSELL_RULES.strength_signals({ tradelines: strong, params, ...over });

  test("all three thresholds cleared fires", () => {
    const out = run();
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.total_limit_cents, 6_000_000);
    assert.strictEqual(out.metrics.open_revolving_lines, 3);
    assert.strictEqual(out.metrics.utilization_bp, 500);
  });

  test("with any threshold unset it does not fire and names every missing one", () => {
    const out = run({ params: { min_total_limit_cents: null, min_open_revolving_lines: 3, max_utilization_pct: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /threshold\(s\) not set: min_total_limit_cents, max_utilization_pct/);
  });

  test("BOUNDARY: exactly at the limit and the line count fires; one under each does not", () => {
    assert.strictEqual(run({ params: { ...params, min_total_limit_cents: 6_000_000 } }).fires, true);
    const overLimit = run({ params: { ...params, min_total_limit_cents: 6_000_001 } });
    assert.strictEqual(overLimit.fires, false);
    assert.match(overLimit.reason, /total limit 6000000 cents is under 6000001/);

    assert.strictEqual(run({ params: { ...params, min_open_revolving_lines: 4 } }).fires, false);
  });

  test("BOUNDARY: exactly at the utilization ceiling fires; one cent over does not", () => {
    const at = [line({ credit_limit_cents: 1_000_000, balance_cents: 300_000 })];
    const over = [line({ credit_limit_cents: 1_000_000, balance_cents: 300_001 })];
    const p = { min_total_limit_cents: 1, min_open_revolving_lines: 1, max_utilization_pct: 30 };
    assert.strictEqual(run({ tradelines: at, params: p }).fires, true);
    const out = run({ tradelines: over, params: p });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /above the 30% ceiling/);
  });

  test("a loc counts toward the limit but not toward the revolving line count", () => {
    const out = run({
      tradelines: [...strong.slice(0, 2), line({ id: "loc", kind: "loc", credit_limit_cents: 2_000_000, balance_cents: 0 })],
      params: { ...params, min_open_revolving_lines: 3 }
    });
    assert.strictEqual(out.fires, false);
    assert.strictEqual(out.metrics.total_limit_cents, 6_000_000);
    assert.match(out.reason, /2 open revolving line\(s\), under 3/);
  });

  test("an incomplete position blocks the claim rather than filling the gap", () => {
    const out = run({ tradelines: [...strong, line({ id: "d", credit_limit_cents: null })] });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /position is incomplete/);
  });

  test("every shortfall is listed, not just the first", () => {
    const out = run({
      tradelines: [line({ credit_limit_cents: 100_000, balance_cents: 90_000 })],
      params
    });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /total limit/);
    assert.match(out.reason, /open revolving line/);
    assert.match(out.reason, /above the 30% ceiling/);
  });

  test("a garbage threshold throws", () => {
    assert.throws(() => run({ params: { ...params, min_total_limit_cents: 1.5 } }), TypeError);
    assert.throws(() => run({ params: { ...params, max_utilization_pct: 101 } }), RangeError);
  });
});

/* ───────────────────────────── the evaluator ───────────────────────────── */

describe("evaluate reports every rule row and every unconfigured condition", () => {
  const rows = [line({ credit_limit_cents: 1_000_000, balance_cents: 250_000 })];
  const prior = [line({ credit_limit_cents: 1_000_000, balance_cents: 500_000 })];
  const liveRules = {
    utilization_drop_clean_pull: rule({
      utilization_ceiling_pct: 30, min_drop_basis_points: null,
      clean_pull_max_inquiries_per_bureau: 2, clean_pull_max_late_payments: 0
    }, { severity: "warning" })
  };

  test("a firing rule produces an alert carrying the frozen thresholds", () => {
    const out = evaluate({
      clientId: "c1", tradelines: rows, previousTradelines: prior, pull: CLEAN,
      rules: liveRules, now: "2026-07-31T00:00:00Z"
    });
    const hit = byKey(out, "utilization_drop_clean_pull");
    assert.strictEqual(hit.fires, true);
    assert.strictEqual(hit.severity, "warning", "the severity comes off the row, not out of the code");
    assert.strictEqual(hit.alert.kind, "utilization_drop_clean_pull");
    assert.strictEqual(hit.alert.payload.rule_snapshot.utilization_ceiling_pct, 30,
      "the threshold that fired is frozen into the alert so it stays explicable after an edit");
    assert.strictEqual(hit.alert.payload.evaluated_at, "2026-07-31T00:00:00.000Z");
    assert.strictEqual(hit.client_id, "c1");
  });

  test("every condition with no rule row is reported, not silently absent", () => {
    const out = evaluate({ tradelines: rows, previousTradelines: prior, pull: CLEAN, rules: liveRules });
    for (const key of ["seasoned_tradelines", "strength_signals", "score_improvement", "card_upgrade_candidate"]) {
      const r = byKey(out, key);
      assert.ok(r, `${key} must appear in the results`);
      assert.strictEqual(r.fires, false);
      assert.match(r.reason, /no upsell_trigger_rules row/);
    }
  });

  test("an inactive rule does not run, and says whether it is still awaiting numbers", () => {
    const out = evaluate({
      tradelines: rows, previousTradelines: prior, pull: CLEAN,
      rules: { utilization_drop_clean_pull: rule({}, { active: false, needs_config: true }) }
    });
    const r = byKey(out, "utilization_drop_clean_pull");
    assert.strictEqual(r.fires, false);
    assert.match(r.reason, /inactive and still needs its thresholds decided/);
  });

  test("this is exactly how the five rules ship in 079: nothing fires and every reason says why", () => {
    const off = { active: false, needs_config: true };
    const asSeeded = {
      utilization_drop_clean_pull: rule({
        utilization_ceiling_pct: null, min_drop_basis_points: null,
        clean_pull_max_inquiries_per_bureau: null, clean_pull_max_late_payments: null
      }, off),
      seasoned_tradelines: rule({ min_age_months: null, min_seasoned_lines: null }, off),
      strength_signals: rule({ min_total_limit_cents: null, min_open_revolving_lines: null, max_utilization_pct: null }, off),
      score_improvement: rule({ min_score_gain: null, min_score: null }, off),
      card_upgrade_candidate: rule({ apr_at_or_above: null, min_balance_cents: null }, off)
    };
    const out = evaluate({
      tradelines: rows, previousTradelines: prior, pull: CLEAN,
      scores: { previous: 640, current: 700 }, rules: asSeeded
    });
    assert.strictEqual(firedAlerts(out).length, 0);
    assert.strictEqual(blanksOf(out).length, 5);
    for (const b of blanksOf(out)) assert.ok(b.reason.length > 0, "a blank without a reason is just silence");
  });

  test("an ACTIVE rule whose thresholds were never filled in still does not fire on a guess", () => {
    // The belt to 079's braces: the CHECK stops needs_config AND active, but a
    // hand-run UPDATE could still activate a row full of nulls.
    const out = evaluate({
      tradelines: rows, previousTradelines: prior, pull: CLEAN,
      rules: { utilization_drop_clean_pull: rule({
        utilization_ceiling_pct: null, clean_pull_max_inquiries_per_bureau: null, clean_pull_max_late_payments: null
      }) }
    });
    assert.strictEqual(byKey(out, "utilization_drop_clean_pull").fires, false);
    assert.match(byKey(out, "utilization_drop_clean_pull").reason, /threshold\(s\) not set/);
  });

  test("a rule key no function implements is reported rather than ignored", () => {
    const out = evaluate({ tradelines: rows, rules: { some_new_idea: rule({ x: 1 }) } });
    const r = byKey(out, "some_new_idea");
    assert.strictEqual(r.fires, false);
    assert.match(r.reason, /no evaluator implements rule_key "some_new_idea"/);
  });

  test("a rule with no severity produces no alert severity, and never invents one", () => {
    const out = evaluate({
      tradelines: rows, previousTradelines: prior, pull: CLEAN,
      rules: { utilization_drop_clean_pull: rule({
        utilization_ceiling_pct: 30, clean_pull_max_inquiries_per_bureau: 2, clean_pull_max_late_payments: 0
      }, { severity: undefined }) }
    });
    assert.strictEqual(byKey(out, "utilization_drop_clean_pull").alert.severity, null);
  });

  test("it is pure: the same inputs give the same output twice, and inputs are not mutated", () => {
    const lines = [line()];
    const frozen = JSON.stringify(lines);
    const args = { tradelines: lines, previousTradelines: prior, pull: CLEAN, rules: liveRules, now: "2026-07-31T00:00:00Z" };
    assert.deepStrictEqual(evaluate(args), evaluate(args));
    assert.strictEqual(JSON.stringify(lines), frozen, "the caller's rows must come back untouched");
  });

  test("garbage arguments throw instead of quietly producing nothing", () => {
    assert.throws(() => evaluate({ tradelines: "nope" }), TypeError);
    assert.throws(() => evaluate({ tradelines: [], previousTradelines: "nope" }), TypeError);
    assert.throws(() => evaluate({ tradelines: [], rules: [] }), TypeError);
    assert.throws(() => evaluate({ tradelines: [], rules: { a: "not a row" } }), TypeError);
    assert.throws(() => evaluate({ tradelines: [], rules: { a: { active: true, params: "nope" } } }), TypeError);
    assert.throws(() => evaluate({ tradelines: [], now: "the future" }), TypeError);
  });

  test("firedAlerts and blanksOf refuse anything that is not a result list", () => {
    assert.throws(() => firedAlerts("nope"), TypeError);
    assert.throws(() => blanksOf(null), TypeError);
  });
});

/* ───────────────── rule 4: score improvement (W4 second pass) ───────────── */

describe("score_improvement needs two readings and will not guess the second", () => {
  const params = { min_score_gain: 20, min_score: 680 };
  const run = (over = {}) => evaluateScore({ params, scores: { previous: 640, current: 700 }, ...over });

  test("a real gain that clears the floor fires", () => {
    const out = run();
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.score_gain, 60);
    assert.strictEqual(out.metrics.score_now, 700);
  });

  test("with no thresholds set it does not fire and names them", () => {
    const out = run({ params: { min_score_gain: null, min_score: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /threshold\(s\) not set: min_score_gain, min_score/);
  });

  test("one reading is not a gain — it refuses rather than treating today as the baseline", () => {
    const out = run({ scores: { previous: null, current: 700 } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /a gain cannot be measured from a single reading/);
    assert.strictEqual(out.metrics.score_now, 700, "what is known is still reported");
  });

  test("no scores at all refuses", () => {
    assert.strictEqual(run({ scores: null }).fires, false);
    assert.match(run({ scores: null }).reason, /no current credit score supplied/);
  });

  test("BOUNDARY: exactly the required gain and exactly the floor both fire; one under each does not", () => {
    assert.strictEqual(run({ scores: { previous: 660, current: 680 } }).fires, true);
    const shortGain = run({ scores: { previous: 661, current: 680 } });
    assert.strictEqual(shortGain.fires, false);
    assert.match(shortGain.reason, /gained 19 point\(s\), under the 20 required/);

    const underFloor = run({ scores: { previous: 600, current: 679 } });
    assert.strictEqual(underFloor.fires, false);
    assert.match(underFloor.reason, /score is 679, under the 680 required/);
  });

  test("a score that fell does not fire", () => {
    const out = run({ scores: { previous: 720, current: 700 } });
    assert.strictEqual(out.fires, false);
    assert.strictEqual(out.metrics.score_gain, -20);
  });

  test("THE THRESHOLD IS THE ROW: the same readings answer differently under a different floor", () => {
    const scores = { previous: 640, current: 700 };
    assert.strictEqual(run({ scores, params: { min_score_gain: 20, min_score: 680 } }).fires, true);
    assert.strictEqual(run({ scores, params: { min_score_gain: 20, min_score: 720 } }).fires, false);
  });

  test("a utilization percentage arriving where a score belongs throws instead of being compared", () => {
    assert.throws(() => scoreOrNull(2500, "score"), RangeError);
    assert.throws(() => run({ scores: { previous: 640, current: 250_000 } }), RangeError);
    assert.throws(() => run({ scores: { previous: "six forty", current: 700 } }), TypeError);
  });
});

/* ──────────── rule 5: card upgrade candidate (W4 second pass) ───────────── */

describe("card_upgrade_candidate treats an unknown APR as unpriced, never as cheap", () => {
  const params = { apr_at_or_above: 0.2499, min_balance_cents: 100_000 };
  const expensive = line({ id: "exp", apr: 0.2999, balance_cents: 500_000 });
  const cheap = line({ id: "cheap", apr: 0.0999, balance_cents: 500_000 });
  const run = (over = {}) => suggestCardUpgrade({ tradelines: [expensive, cheap], params, ...over });

  test("an expensive card with a real balance is a candidate, and the interest is stated", () => {
    const out = run();
    assert.strictEqual(out.fires, true);
    assert.strictEqual(out.metrics.candidates.length, 1);
    assert.strictEqual(out.metrics.candidates[0].id, "exp");
    assert.strictEqual(out.metrics.candidates[0].interest_at_current_balance_cents, 149_950); // $1,499.50
    assert.ok(Number.isInteger(out.metrics.candidates[0].interest_at_current_balance_cents));
  });

  test("with no thresholds set it does not fire and names them", () => {
    const out = run({ params: { apr_at_or_above: null, min_balance_cents: null } });
    assert.strictEqual(out.fires, false);
    assert.match(out.reason, /threshold\(s\) not set: apr_at_or_above, min_balance_cents/);
  });

  test("BOUNDARY: exactly at the APR floor and exactly at the balance floor both qualify", () => {
    const out = run({ tradelines: [line({ apr: 0.2499, balance_cents: 100_000 })] });
    assert.strictEqual(out.fires, true);
  });

  test("BOUNDARY: a hair under either threshold does not qualify", () => {
    assert.strictEqual(run({ tradelines: [line({ apr: 0.2498, balance_cents: 500_000 })] }).fires, false);
    assert.strictEqual(run({ tradelines: [line({ apr: 0.2999, balance_cents: 99_999 })] }).fires, false);
  });

  test("a card with no APR is counted as unpriced and the reason says so", () => {
    const out = run({ tradelines: [cheap, line({ id: "unknown", apr: null, balance_cents: 900_000 })] });
    assert.strictEqual(out.fires, false);
    assert.strictEqual(out.metrics.lines_with_no_apr, 1);
    assert.match(out.reason, /unpriced, not cheap/);
  });

  test("candidates come back most expensive first", () => {
    const out = run({ tradelines: [
      line({ id: "a", apr: 0.2599, balance_cents: 200_000 }),
      line({ id: "b", apr: 0.3499, balance_cents: 200_000 })
    ] });
    assert.deepStrictEqual(out.metrics.candidates.map((c) => c.id), ["b", "a"]);
  });

  test("a line of credit and a closed card are not card-upgrade candidates", () => {
    const out = run({ tradelines: [
      line({ id: "loc", kind: "loc", apr: 0.2999, balance_cents: 500_000 }),
      line({ id: "shut", apr: 0.2999, balance_cents: 500_000, closed_at: "2026-01-01T00:00:00Z" })
    ] });
    assert.strictEqual(out.fires, false);
    assert.strictEqual(out.metrics.open_revolving_lines, 0);
  });

  test("THE THRESHOLD IS THE ROW: the same cards answer differently under a different APR floor", () => {
    assert.strictEqual(run({ params: { apr_at_or_above: 0.2499, min_balance_cents: 1 } }).metrics.candidates.length, 1);
    assert.strictEqual(run({ params: { apr_at_or_above: 0.0500, min_balance_cents: 1 } }).metrics.candidates.length, 2);
  });

  test("an APR given as a percentage throws rather than being read as 2499%", () => {
    assert.throws(() => aprFractionOrNull(24.99, "apr"), RangeError);
    assert.throws(() => run({ params: { apr_at_or_above: 24.99, min_balance_cents: 1 } }), RangeError);
    assert.throws(() => run({ tradelines: [line({ apr: 24.99 })] }), RangeError);
  });
});

describe("the four named entry points are names for the rules, not second copies", () => {
  test("evaluateUtilization is the same function evaluate() runs for that rule row", () => {
    const args = {
      tradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 250_000 })],
      previousTradelines: [line({ credit_limit_cents: 1_000_000, balance_cents: 500_000 })],
      pull: CLEAN,
      params: { utilization_ceiling_pct: 30, min_drop_basis_points: null,
                clean_pull_max_inquiries_per_bureau: 2, clean_pull_max_late_payments: 0 }
    };
    const direct = evaluateUtilization(args);
    const viaEvaluate = evaluate({
      ...args, rules: { utilization_drop_clean_pull: rule(args.params) }
    }).find((r) => r.rule_key === "utilization_drop_clean_pull");
    assert.strictEqual(direct.fires, viaEvaluate.fires);
    assert.deepStrictEqual(direct.metrics, viaEvaluate.metrics);
    assert.strictEqual(direct.reason, viaEvaluate.reason);
  });

  test("evaluateScore and suggestCardUpgrade agree with their rule rows too", () => {
    const scoreParams = { min_score_gain: 20, min_score: 680 };
    const scores = { previous: 640, current: 700 };
    assert.strictEqual(
      evaluateScore({ params: scoreParams, scores }).reason,
      evaluate({ scores, rules: { score_improvement: rule(scoreParams) } })
        .find((r) => r.rule_key === "score_improvement").reason
    );

    const cardParams = { apr_at_or_above: 0.2499, min_balance_cents: 100_000 };
    const tradelines = [line({ apr: 0.2999, balance_cents: 500_000 })];
    assert.strictEqual(
      suggestCardUpgrade({ params: cardParams, tradelines }).reason,
      evaluate({ tradelines, rules: { card_upgrade_candidate: rule(cardParams) } })
        .find((r) => r.rule_key === "card_upgrade_candidate").reason
    );
  });

  test("all five conditions are implemented, so no rule row in 079 is orphaned", () => {
    assert.deepStrictEqual(Object.keys(UPSELL_RULES).sort(), [
      "card_upgrade_candidate", "score_improvement", "seasoned_tradelines",
      "strength_signals", "utilization_drop_clean_pull"
    ]);
  });

  test("the entry points refuse a non-object argument rather than reading undefined", () => {
    assert.throws(() => evaluateUtilization("nope"), TypeError);
    assert.throws(() => evaluateScore([]), TypeError);
    assert.throws(() => suggestCardUpgrade({ params: "nope" }), TypeError);
  });
});
