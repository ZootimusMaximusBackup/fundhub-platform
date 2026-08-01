// Unit tests for the W7 -> W8 seam. PURE — no database, no clock.
//
// The three breaks this file exists to close, each asserted directly:
//   1. confidence scale  — W8 validates 0-1; the detector emits 0-100.
//   2. sign              — W8 requires non-negative; the detector emits negative.
//   3. dates             — W8 has no recurrence engine and says so.
//
// Break 1 is the one that fails SILENTLY (every bill quietly demoted to
// "unconfirmed"), so it gets the most direct assertions.

import { test } from "node:test";
import assert from "node:assert";

import { detectRecurringBills } from "./recurring.mjs";
import {
  expectedOccurrences,
  toCashflowBill,
  toCashflowBills,
  PRESENTABLE_CONFIDENCE_FLOOR,
  SEAM_REASONS
} from "./cashflow-seam.mjs";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

let seq = 0;
function tx(postedOn, amountCents, overrides = {}) {
  seq += 1;
  return {
    id: `txn-${seq}`,
    bank_account_id: ACCOUNT,
    provider_transaction_id: `prov-${seq}`,
    amount_cents: amountCents,
    posted_on: postedOn,
    merchant_name: "NETFLIX.COM",
    is_pending: false,
    ...overrides
  };
}

/** A confident monthly bill on the 15th, detected as of 2026-06-20. */
function monthlyBill(overrides = {}) {
  const rows = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
    .map((ym) => tx(`${ym}-15`, -1599, overrides));
  const r = detectRecurringBills(rows, { now: "2026-06-20" });
  assert.equal(r.bills.length, 1, "fixture must produce exactly one bill");
  return r.bills[0];
}

/** A two-occurrence guess — low confidence, no next date. */
function guess() {
  const rows = [tx("2026-05-03", -4500, { merchant_name: "GYM" }),
    tx("2026-06-03", -4500, { merchant_name: "GYM" })];
  const r = detectRecurringBills(rows, { now: "2026-06-20" });
  assert.equal(r.candidates.length, 1);
  return r.candidates[0];
}

/* ========================================================================= *
 * Break 1 — the confidence scale, and the silent failure
 * ========================================================================= */

test("confidence crosses the seam as a 0-1 fraction, which is what W8 validates", () => {
  const bill = monthlyBill();
  assert.ok(bill.confidencePct > 1, "the detector's own scale is 0-100");

  const shaped = toCashflowBill(bill, { from: "2026-06-20", to: "2026-12-31" });

  assert.equal(shaped.confidence, bill.confidencePct / 100);
  assert.ok(shaped.confidence >= 0 && shaped.confidence <= 1,
    "*** outside 0-1 W8 throws CashflowInputError ***");
});

test("confidence is always present, because an absent one is silently demoted", () => {
  // This is the dangerous break. W8 reads a missing `confidence` as "no
  // confidence was supplied" and classifies the bill UNCONFIRMED — a complete,
  // plausible projection in which every detected bill has quietly been
  // downgraded, with no error raised anywhere.
  const { recurringBills } = toCashflowBills(
    detectRecurringBills(
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        .map((ym) => tx(`${ym}-15`, -1599)),
      { now: "2026-06-20" }
    ),
    { from: "2026-06-20", to: "2026-12-31" }
  );

  assert.ok(recurringBills.length > 0);
  for (const b of recurringBills) {
    assert.equal(typeof b.confidence, "number");
    assert.ok(Number.isFinite(b.confidence), "null or undefined would demote it silently");
  }
});

test("`confirmed` is never set — an inferred bill is always a guess, however good", () => {
  const shaped = toCashflowBill(monthlyBill(), { from: "2026-06-20", to: "2026-12-31" });
  assert.equal(shaped.confirmed, undefined,
    "W8 reads confirmed:true as 'not a guess at all', which this never is");
});

test("the exported floor admits exactly the bands this repo calls presentable", () => {
  const bill = monthlyBill();
  const shaped = toCashflowBill(bill, { from: "2026-06-20", to: "2026-12-31" });
  assert.ok(shaped.confidence >= PRESENTABLE_CONFIDENCE_FLOOR,
    "a detected bill must clear the floor the seam publishes");

  const low = toCashflowBill(guess(), { from: "2026-06-20", to: "2026-12-31" });
  assert.ok(low.confidence < PRESENTABLE_CONFIDENCE_FLOOR,
    "and a low-confidence guess must not");
});

/* ========================================================================= *
 * Break 2 — the sign
 * ========================================================================= */

test("amounts cross the seam as POSITIVE magnitudes, flipped in exactly one place", () => {
  const bill = monthlyBill();
  assert.ok(bill.typicalAmountCents < 0, "this repo's convention: an outflow is negative");

  const { occurrences } = expectedOccurrences(bill, { from: "2026-06-20", to: "2026-09-30" });

  assert.ok(occurrences.length > 0);
  for (const o of occurrences) {
    assert.equal(o.amountCents, 1599);
    assert.ok(o.amountCents > 0, "*** W8 runs this through requireNonNegativeCents ***");
  }
});

test("the magnitude is exact — the flip must not round, scale or lose a cent", () => {
  const rows = ["2026-01", "2026-02", "2026-03", "2026-04"].map((ym) => tx(`${ym}-09`, -123_456));
  const bill = detectRecurringBills(rows, { now: "2026-04-15" }).bills[0];

  const { occurrences } = expectedOccurrences(bill, { from: "2026-04-15", to: "2026-06-30" });

  assert.equal(occurrences[0].amountCents, 123_456);
  assert.equal(occurrences[0].amountCents, -bill.typicalAmountCents);
});

/* ========================================================================= *
 * Break 3 — the dates
 * ========================================================================= */

test("a cadence expands into the dated series W8 refuses to compute itself", () => {
  const bill = monthlyBill();

  const { occurrences } = expectedOccurrences(bill, { from: "2026-06-20", to: "2026-11-30" });

  assert.deepEqual(occurrences.map((o) => o.date), [
    "2026-07-15", "2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"
  ]);
});

test("weekly, biweekly and annual all expand on their own cadence", () => {
  const weekly = detectRecurringBills(
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]
      .map((d) => tx(d, -2500)), { now: "2026-07-01" }).bills[0];
  assert.deepEqual(
    expectedOccurrences(weekly, { from: "2026-07-01", to: "2026-07-31" }).occurrences
      .map((o) => o.date),
    ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]
  );

  const biweekly = detectRecurringBills(
    ["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27", "2026-03-13"]
      .map((d) => tx(d, -45000)), { now: "2026-03-20" }).bills[0];
  assert.deepEqual(
    expectedOccurrences(biweekly, { from: "2026-03-20", to: "2026-05-01" }).occurrences
      .map((o) => o.date),
    ["2026-03-27", "2026-04-10", "2026-04-24"]
  );

  const annual = detectRecurringBills(
    ["2023-03-02", "2024-03-02", "2025-03-02", "2026-03-02"].map((d) => tx(d, -9900)),
    { now: "2026-04-01" }).bills[0];
  assert.deepEqual(
    expectedOccurrences(annual, { from: "2026-04-01", to: "2029-01-01" }).occurrences
      .map((o) => o.date),
    ["2027-03-02", "2028-03-02"]
  );
});

test("a month-end bill keeps its day-of-month across short months", () => {
  const rows = ["2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31"].map((d) => tx(d, -5000));
  const bill = detectRecurringBills(rows, { now: "2026-04-02" }).bills[0];

  const dates = expectedOccurrences(bill, { from: "2026-04-01", to: "2026-08-01" })
    .occurrences.map((o) => o.date);

  assert.deepEqual(dates, ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31"],
    "clamped only for months that are genuinely shorter, never drifting down permanently");
});

test("the window is inclusive at both ends and excludes what falls outside it", () => {
  const bill = monthlyBill();

  const exact = expectedOccurrences(bill, { from: "2026-07-15", to: "2026-07-15" });
  assert.deepEqual(exact.occurrences.map((o) => o.date), ["2026-07-15"]);

  const before = expectedOccurrences(bill, { from: "2026-06-20", to: "2026-07-14" });
  assert.deepEqual(before.occurrences, []);
  assert.equal(before.skippedReason, SEAM_REASONS.WINDOW_EMPTY);
});

test("occurrences BEFORE the window start are dropped, not carried into it", () => {
  // MUTATION-CHECKED. The earlier window test could not see the start filter at
  // all: its first occurrence already fell on or after `from`, so deleting the
  // check changed nothing. A window that opens well after the bill's next date
  // is what actually exercises it — and it is the realistic case, because a
  // projection is usually asked for a future slice, not for today onward.
  const bill = monthlyBill();
  assert.equal(bill.nextExpectedDate, "2026-07-15");

  const { occurrences } = expectedOccurrences(bill, { from: "2026-09-01", to: "2026-11-30" });

  assert.deepEqual(occurrences.map((o) => o.date),
    ["2026-09-15", "2026-10-15", "2026-11-15"],
    "*** July and August are in the past for this window and must not appear ***");
});

test("expansion refuses to run without a window — there is no clock here either", () => {
  const bill = monthlyBill();
  assert.throws(() => expectedOccurrences(bill, {}), /`from` is required/);
  assert.throws(() => expectedOccurrences(bill, { from: "2026-06-20" }), /`to` is required/);
  assert.throws(() => expectedOccurrences(bill, { from: "2026-06-20", to: "nonsense" }),
    /`to` is required/);
  assert.throws(() => expectedOccurrences(bill, { from: "2026-08-01", to: "2026-07-01" }),
    /precedes/);
});

test("a long window cannot run away — the occurrence count is bounded", () => {
  const weekly = detectRecurringBills(
    ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]
      .map((d) => tx(d, -2500)), { now: "2026-07-01" }).bills[0];

  const { occurrences } = expectedOccurrences(weekly,
    { from: "2026-07-01", to: "2126-07-01", maxOccurrences: 10 });

  assert.equal(occurrences.length, 10);
});

/* ========================================================================= *
 * The honesty rule survives the crossing
 * ========================================================================= */

test("a bill with no confident next date expands to NOTHING, with a reason", () => {
  // *** The whole point. Inventing a first date here would launder the
  // detector's uncertainty into a number a projection treats as real, three
  // modules from where anyone could check it. ***
  const g = guess();
  assert.equal(g.nextExpectedDate, null);

  const out = expectedOccurrences(g, { from: "2026-06-20", to: "2027-06-20" });

  assert.deepEqual(out.occurrences, [], "no date in, no dates out");
  assert.equal(out.skippedReason, SEAM_REASONS.NO_CONFIDENT_DATE);
});

test("low-confidence candidates are excluded by default, and reported rather than vanishing", () => {
  const rows = [
    ...["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
      .map((ym) => tx(`${ym}-15`, -1599)),
    ...["2026-05-03", "2026-06-03"].map((d) => tx(d, -4500, { merchant_name: "GYM" }))
  ];
  const result = detectRecurringBills(rows, { now: "2026-06-20" });
  assert.equal(result.bills.length, 1);
  assert.equal(result.candidates.length, 1);

  const { recurringBills, skipped } = toCashflowBills(result,
    { from: "2026-06-20", to: "2026-12-31" });

  assert.equal(recurringBills.length, 1, "the guess is not projected");

  // MUTATION-CHECKED, and it exposed something worth stating plainly: a
  // candidate can NEVER produce an occurrence, because low confidence means the
  // detector refused it a next date in the first place. So `includeCandidates`
  // cannot change `recurringBills` — asserting only its length let "project
  // candidates by default" survive untouched. What the flag actually changes is
  // WHY the candidate is absent, and that distinction is the thing worth
  // keeping: "excluded on purpose" and "processed and found undatable" are
  // different statements about the same merchant.
  assert.deepEqual(skipped, [{
    billId: `${result.candidates[0].bankAccountId}:GYM:monthly`,
    reason: SEAM_REASONS.LOW_CONFIDENCE_EXCLUDED
  }], "excluded on purpose, and reported exactly once");
});

test("asking for candidates changes WHY one is absent, not whether it is projected", () => {
  const rows = [
    ...["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
      .map((ym) => tx(`${ym}-15`, -1599)),
    ...["2026-05-03", "2026-06-03"].map((d) => tx(d, -4500, { merchant_name: "GYM" }))
  ];
  const result = detectRecurringBills(rows, { now: "2026-06-20" });
  const billId = `${result.candidates[0].bankAccountId}:GYM:monthly`;

  const asked = toCashflowBills(result,
    { from: "2026-06-20", to: "2026-12-31", includeCandidates: true });

  assert.equal(asked.recurringBills.length, 1, "still not projected — it has no date to project");
  assert.deepEqual(asked.skipped, [{ billId, reason: SEAM_REASONS.NO_CONFIDENT_DATE }],
    "processed and declined for lack of a date, NOT excluded by policy");
});

test("including candidates carries their REAL confidence — nothing is promoted in transit", () => {
  const rows = [
    ...["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
      .map((ym) => tx(`${ym}-15`, -1599)),
    ...["2026-05-03", "2026-06-03"].map((d) => tx(d, -4500, { merchant_name: "GYM" }))
  ];
  const result = detectRecurringBills(rows, { now: "2026-06-20" });

  const { recurringBills } = toCashflowBills(result,
    { from: "2026-06-20", to: "2026-12-31", includeCandidates: true });

  // The candidate still has no next date, so it still projects nothing — being
  // asked for does not manufacture one.
  assert.equal(recurringBills.length, 1);
  for (const b of recurringBills) {
    assert.ok(b.confidence >= PRESENTABLE_CONFIDENCE_FLOOR);
  }
});

/* ========================================================================= *
 * Shape
 * ========================================================================= */

test("the emitted entry matches W8's documented recurringBills shape", () => {
  const { recurringBills } = toCashflowBills(
    detectRecurringBills(
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
        .map((ym) => tx(`${ym}-15`, -1599)),
      { now: "2026-06-20" }
    ),
    { from: "2026-06-20", to: "2026-09-30" }
  );

  const entry = recurringBills[0];
  /* `subjectId` joined this shape deliberately. billId is the COMPOSITE stream
     identity and cannot be written to a uuid column; cashflow_reminders
     .subject_id is one (087:113), and passing billId there raised Postgres
     22P02 on the exact case the cash-flow screen exists for. subjectId carries
     the stored row's own uuid, and is NULL for a bill built by hand — as it is
     here, where the input is a detector result that was never stored. */
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["billId", "confidence", "label", "occurrences", "subjectId"]
  );
  assert.equal(typeof entry.billId, "string");
  assert.equal(typeof entry.label, "string");
  assert.ok(Array.isArray(entry.occurrences));
  assert.equal(entry.subjectId, null, "a bill that was never stored has no row id to point at");
  for (const o of entry.occurrences) {
    assert.deepEqual(Object.keys(o).sort(), ["amountCents", "date"]);
    assert.match(o.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(o.amountCents) && o.amountCents >= 0);
  }
});

test("billId is stable across runs and distinct per account, merchant and cadence", () => {
  const a = toCashflowBill(monthlyBill(), { from: "2026-06-20", to: "2026-09-30" });
  const b = toCashflowBill(monthlyBill(), { from: "2026-06-20", to: "2026-09-30" });
  assert.equal(a.billId, b.billId, "the same bill must not become a new id every run");

  const other = toCashflowBill(
    { ...monthlyBill(), bankAccountId: "22222222-2222-4222-8222-222222222222" },
    { from: "2026-06-20", to: "2026-09-30" }
  );
  assert.notEqual(a.billId, other.billId, "the same merchant on two accounts is two bills");
});

test("an empty or absent detection produces an empty list, not an error", () => {
  assert.deepEqual(
    toCashflowBills({ bills: [], candidates: [] }, { from: "2026-01-01", to: "2026-12-31" }),
    { recurringBills: [], skipped: [] }
  );
  assert.throws(() => toCashflowBills(null, { from: "2026-01-01", to: "2026-12-31" }),
    /expected a detectRecurringBills\(\) result/);
});

test("an unknown cadence is refused rather than guessed at", () => {
  assert.throws(
    () => expectedOccurrences(
      { ...monthlyBill(), cadence: "fortnightly" },
      { from: "2026-06-20", to: "2026-12-31" }
    ),
    /unknown cadence/
  );
});
