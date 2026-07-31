// Unit tests for recurring-bill detection. PURE — no database, no clock, no
// network. Every test pins `now` and asserts an exact answer.
//
// WHAT THESE TESTS ARE FOR. The module's whole job is to be honest about a
// guess. So the tests that matter most here are not the happy paths; they are
// the ones that assert the detector REFUSES to answer:
//
//   - two occurrences never become a confident bill, and never get a date;
//   - a low-confidence detection never appears in `bills`;
//   - a NULL next-expected-date always carries a reason;
//   - a positive (inflow) amount is never silently abs()'d into a bill;
//   - nothing is ever dropped without a named reason.
//
// AUDIT-FINDINGS' closing lesson: "Mutation-test the OVER-broad direction too.
// Several tests here asserted the defect ... and passed happily for months." So
// several tests below assert the ABSENCE of a value — no date, no bill, an
// empty array — rather than only asserting that good input produces good output.

import { test } from "node:test";
import assert from "node:assert";

import {
  detectRecurringBills,
  normaliseMerchant,
  medianCents,
  parseDay,
  formatDay,
  isOutflow,
  isInflow,
  toBillRow,
  capLabelForEvidence,
  MAX_CONFIDENCE,
  SIGN_CONVENTION,
  CADENCES,
  CADENCE_NAMES,
  PRESENTABLE_LABELS,
  REASONS,
  EXCLUSION_REASONS
} from "./recurring.mjs";

/* ========================================================================= *
 * Fixtures
 * ========================================================================= */

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const ORG = "44444444-4444-4444-8444-444444444444";

let seq = 0;

/** A bank_transactions-shaped row. Outflow by default, per the convention. */
function tx(postedOn, amountCents, overrides = {}) {
  seq += 1;
  return {
    id: `txn-${seq}`,
    bank_account_id: ACCOUNT_A,
    client_id: CLIENT,
    provider_transaction_id: `prov-${seq}`,
    amount_cents: amountCents,
    posted_on: postedOn,
    merchant_name: "NETFLIX.COM",
    is_pending: false,
    ...overrides
  };
}

/** The same charge on the 15th of each month named. */
function monthlyOn15th(months, amountCents = -1599, overrides = {}) {
  return months.map((ym) => tx(`${ym}-15`, amountCents, overrides));
}

const only = (arr) => {
  assert.equal(arr.length, 1, `expected exactly one, got ${arr.length}`);
  return arr[0];
};

/* ========================================================================= *
 * The sign convention
 * ========================================================================= */

test("the sign convention is stated as a value, not just in a comment", () => {
  assert.equal(SIGN_CONVENTION.outflow, "negative");
  assert.equal(SIGN_CONVENTION.inflow, "positive");
  assert.equal(isOutflow(-1), true);
  assert.equal(isOutflow(1), false);
  assert.equal(isOutflow(0), false, "zero is neither");
  assert.equal(isInflow(1), true);
  assert.equal(isInflow(-1), false);
  assert.equal(isOutflow(-1.5), false, "cents are integers");
  assert.equal(isOutflow("-100"), false, "a string is not integer cents");
});

test("a positive amount is an inflow and is NEVER abs()'d into a bill", () => {
  // A whole batch that forgot to negate at the Plaid boundary. The honest
  // answer is zero bills and a loud, specific exclusion for every row — not a
  // confident, plausible, completely wrong set of bills.
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"], 1599);

  const r = detectRecurringBills(rows, { now: "2026-04-20" });

  assert.deepEqual(r.bills, []);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.excluded.length, 4);
  for (const e of r.excluded) {
    assert.equal(e.reason, EXCLUSION_REASONS.INFLOW);
  }
});

test("inflows mixed into a real bill's history do not inflate it", () => {
  // A refund from the same merchant is an inflow. Counting it as an occurrence
  // would add evidence for a bill out of a row that is the opposite of one.
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]),
    tx("2026-02-20", 1599) // the refund
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);
  assert.equal(bill.occurrenceCount, 3);
  assert.equal(bill.typicalAmountCents, -1599);
});

test("a bill's stored amount is negative, and min/max keep the same sign", () => {
  const rows = [
    tx("2026-01-15", -1000), tx("2026-02-15", -2000), tx("2026-03-15", -3000)
  ];
  // An amount that triples lands this in `candidates`, not `bills` — which is
  // itself correct, and is asserted elsewhere. Here the subject is the SIGN.
  const r = detectRecurringBills(rows, { now: "2026-03-20" });
  const bill = only([...r.bills, ...r.candidates]);
  assert.equal(bill.typicalAmountCents, -2000);
  assert.equal(bill.amountMinCents, -3000, "min = largest outflow");
  assert.equal(bill.amountMaxCents, -1000, "max = smallest outflow");
  assert.ok(isOutflow(bill.typicalAmountCents));
});

/* ========================================================================= *
 * TWO OCCURRENCES ARE NOT A PATTERN — the headline rule
 * ========================================================================= */

test("two occurrences 31 days apart do NOT become a confident monthly bill", () => {
  const rows = monthlyOn15th(["2026-05", "2026-06"]);

  const r = detectRecurringBills(rows, { now: "2026-06-20" });

  assert.deepEqual(r.bills, [], "*** a two-occurrence guess must never reach `bills` ***");
  const c = only(r.candidates);
  assert.equal(c.occurrenceCount, 2);
  assert.equal(c.confidenceLabel, "low");
  assert.ok(c.confidencePct < 55, `expected below the medium band, got ${c.confidencePct}`);
  assert.equal(c.nextExpectedDate, null, "*** no date for a two-point guess ***");
  assert.equal(c.nextExpectedUnknownReason, REASONS.TWO_OCCURRENCES);
});

test("the two-occurrence cap holds even for a textbook-perfect interval", () => {
  // Exactly 14 days apart, identical amounts, recent, zero fit error. Every
  // input signal says "biweekly". There is still only one interval, and one
  // interval always fits, so the answer is still capped at 'low'.
  const rows = [tx("2026-06-01", -5000), tx("2026-06-15", -5000)];

  const r = detectRecurringBills(rows, { now: "2026-06-16" });

  assert.deepEqual(r.bills, []);
  const c = only(r.candidates);
  assert.equal(c.cadence, "biweekly");
  assert.equal(c.confidenceLabel, "low");
  assert.equal(c.nextExpectedDate, null);
  assert.equal(c.nextExpectedUnknownReason, REASONS.TWO_OCCURRENCES);
});

test("the third occurrence is what turns a guess into a bill", () => {
  const two = detectRecurringBills(monthlyOn15th(["2026-01", "2026-02"]), { now: "2026-02-20" });
  const three = detectRecurringBills(monthlyOn15th(["2026-01", "2026-02", "2026-03"]), { now: "2026-03-20" });

  assert.equal(two.bills.length, 0);
  assert.equal(two.candidates.length, 1);

  const bill = only(three.bills);
  assert.equal(bill.confidenceLabel, "medium");
  assert.equal(bill.nextExpectedDate, "2026-04-15");
  assert.equal(bill.nextExpectedUnknownReason, null);
  assert.ok(
    bill.confidencePct > two.candidates[0].confidencePct,
    "more evidence must score higher"
  );
});

test("the two-occurrence cap is asserted directly, because no input can reach it", () => {
  // MUTATION-CHECKED. Deleting capLabelForEvidence's body survived every
  // scenario test above, because the two-occurrence base score (42) already
  // sits below 'medium' and the cap therefore never fires on real input. That
  // makes it a guard with no test — exactly how the defects in AUDIT-FINDINGS
  // survived for months ("Mutation-test the OVER-broad direction too"). So the
  // guard is asserted on its own terms here. It is the thing that stops a
  // future edit to the base table silently promoting a two-point guess.
  assert.equal(capLabelForEvidence("high", 2), "low");
  assert.equal(capLabelForEvidence("medium", 2), "low");
  assert.equal(capLabelForEvidence("high", 1), "low");
  assert.equal(capLabelForEvidence("low", 2), "low");
  assert.equal(capLabelForEvidence("none", 2), "none", "the cap lowers, it never raises");
  assert.equal(capLabelForEvidence("high", 3), "high", "three occurrences are not capped");
  assert.equal(capLabelForEvidence("medium", 5), "medium");
});

test("the confidence ceiling is asserted directly, for the same reason", () => {
  // Also mutation-checked and also unreachable: the highest base is 88 and
  // every other term is a penalty, so nothing can climb to the clamp. The
  // policy it encodes — nothing inferred from a transaction history is
  // certain — is worth keeping, so it is asserted rather than left untested.
  assert.equal(MAX_CONFIDENCE, 95);
  assert.ok(MAX_CONFIDENCE < 100, "*** a detected bill is never a certainty ***");
});

test("one occurrence is rejected outright — it is not recurring", () => {
  const r = detectRecurringBills([tx("2026-03-15", -1599)], { now: "2026-03-20" });
  assert.deepEqual(r.bills, []);
  assert.deepEqual(r.candidates, []);
  const rej = only(r.rejected);
  assert.equal(rej.reason, REASONS.SINGLE_OCCURRENCE);
  assert.equal(rej.occurrenceCount, 1);
});

/* ========================================================================= *
 * A date we do not believe is worse than no date
 * ========================================================================= */

test("every null next-expected-date carries a reason, and every date carries none", () => {
  const cases = [
    monthlyOn15th(["2026-05", "2026-06"]),                                  // two only
    monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]), // clean
    ["2026-01-03", "2026-01-19", "2026-02-27", "2026-04-30"].map((d) => tx(d, -1234))
  ];

  for (const rows of cases) {
    const r = detectRecurringBills(rows, { now: "2026-06-20" });
    for (const item of [...r.bills, ...r.candidates]) {
      const hasDate = item.nextExpectedDate !== null;
      const hasReason = item.nextExpectedUnknownReason !== null;
      assert.equal(
        hasDate, !hasReason,
        "exactly one of nextExpectedDate / nextExpectedUnknownReason must be set — " +
        "this mirrors recurring_bills_next_expected_reason_ck in migration 086"
      );
      if (hasReason) {
        assert.ok(Object.values(REASONS).includes(item.nextExpectedUnknownReason));
      }
    }
  }
});

test("a low-confidence detection is refused a date with a named reason", () => {
  // Irregular intervals: the cadence fits some of them and not others.
  const rows = ["2026-01-03", "2026-01-19", "2026-02-27", "2026-04-30"].map((d) => tx(d, -1234));

  const r = detectRecurringBills(rows, { now: "2026-05-05" });

  assert.deepEqual(r.bills, []);
  const c = only(r.candidates);
  assert.equal(c.confidenceLabel, "low");
  assert.equal(c.nextExpectedDate, null);
  assert.equal(c.nextExpectedUnknownReason, REASONS.LOW_CONFIDENCE);
});

test("a bill whose charges stopped gets no next date — it gets an explanation", () => {
  // Seven clean monthly charges, then nothing for four months. The pattern is
  // strong enough to name; the bill is not being paid any more. Emitting
  // "next: 2025-11-10" here would put a payment nobody will make into a cash
  // flow projection.
  const rows = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"]
    .map((ym) => tx(`${ym}-10`, -150000));

  const bill = only(detectRecurringBills(rows, { now: "2025-11-20" }).bills);

  assert.equal(bill.cadence, "monthly");
  assert.equal(bill.nextExpectedDate, null);
  assert.equal(bill.nextExpectedUnknownReason, REASONS.STOPPED);
});

test("a prediction that has just slipped past `now` rolls forward rather than going stale", () => {
  // Last charge 2026-06-15; `now` is 2026-07-20, so 2026-07-15 is already past.
  // One roll gets to 2026-08-15, which is within MAX_ROLL_FORWARD.
  const rows = monthlyOn15th(["2026-03", "2026-04", "2026-05", "2026-06"]);

  const bill = only(detectRecurringBills(rows, { now: "2026-07-20" }).bills);

  assert.equal(bill.nextExpectedDate, "2026-08-15");
  assert.equal(bill.nextExpectedUnknownReason, null);
});

/* ========================================================================= *
 * Cadence classification
 * ========================================================================= */

test("weekly is detected and dated", () => {
  const rows = ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]
    .map((d) => tx(d, -2500));

  const bill = only(detectRecurringBills(rows, { now: "2026-07-01" }).bills);

  assert.equal(bill.cadence, "weekly");
  assert.equal(bill.nextExpectedDate, "2026-07-06");
  assert.equal(bill.confidenceLabel, "high");
});

test("biweekly is detected and is NOT reported as weekly-with-every-other-one-missing", () => {
  const rows = ["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27", "2026-03-13"]
    .map((d) => tx(d, -45000));

  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);

  assert.equal(bill.cadence, "biweekly");
  assert.equal(bill.missedPeriods, 0, "biweekly explains this with no unobserved charges");
  assert.equal(bill.nextExpectedDate, "2026-03-27");
});

test("monthly is NOT reported as biweekly-with-every-other-one-missing", () => {
  // Both cadences "fit" a 30-day gap. Monthly needs no unobserved charges;
  // biweekly needs one per gap. Fewest-missed decides, and it must decide right.
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"]);

  const bill = only(detectRecurringBills(rows, { now: "2026-04-20" }).bills);

  assert.equal(bill.cadence, "monthly");
  assert.equal(bill.missedPeriods, 0);
});

test("an annual charge is detected as annual, not as monthly-with-eleven-missed", () => {
  const rows = ["2023-03-02", "2024-03-02", "2025-03-02", "2026-03-02"].map((d) => tx(d, -9900));

  const bill = only(detectRecurringBills(rows, { now: "2026-04-01" }).bills);

  assert.equal(bill.cadence, "annual");
  assert.equal(bill.missedPeriods, 0);
  assert.equal(bill.nextExpectedDate, "2027-03-02");
  assert.equal(bill.typicalAmountCents, -9900);
});

test("an annual charge across a leap year is still annual", () => {
  const rows = ["2023-02-28", "2024-02-28", "2025-02-28", "2026-02-28"].map((d) => tx(d, -12000));
  const bill = only(detectRecurringBills(rows, { now: "2026-03-05" }).bills);
  assert.equal(bill.cadence, "annual");
  assert.equal(bill.nextExpectedDate, "2027-02-28");
});

test("a monthly bill and an annual renewal at the same merchant are separate answers", () => {
  // 086 keys on (account, merchant_key, cadence) precisely so this is possible.
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"], -999,
      { merchant_name: "ADOBE MONTHLY" }),
    ...["2023-05-02", "2024-05-02", "2025-05-02"].map((d) =>
      tx(d, -19900, { merchant_name: "ADOBE ANNUAL" }))
  ];

  const r = detectRecurringBills(rows, { now: "2026-04-20" });
  const cadences = r.bills.map((b) => [b.merchantKey, b.cadence]).sort();

  assert.deepEqual(cadences, [["ADOBE ANNUAL", "annual"], ["ADOBE MONTHLY", "monthly"]]);
});

test("the cadence vocabulary matches migration 086's CHECK exactly", () => {
  assert.deepEqual([...CADENCE_NAMES].sort(), ["annual", "biweekly", "monthly", "weekly"]);
  for (const name of CADENCE_NAMES) assert.equal(CADENCES[name].name, name);
});

test("charges with no repeating interval at all are rejected, not forced into a cadence", () => {
  const rows = ["2026-01-02", "2026-01-05", "2026-02-19", "2026-02-20", "2026-05-30"]
    .map((d) => tx(d, -700));

  const r = detectRecurringBills(rows, { now: "2026-06-01" });

  assert.deepEqual(r.bills, []);
  const rej = only(r.rejected);
  assert.ok([REASONS.NO_CADENCE].includes(rej.reason));
});

/* ========================================================================= *
 * A skipped month
 * ========================================================================= */

test("a skipped month is monthly-with-one-missed, not a broken pattern", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-04", "2026-05"]);

  const bill = only(detectRecurringBills(rows, { now: "2026-05-20" }).bills);

  assert.equal(bill.cadence, "monthly");
  assert.equal(bill.occurrenceCount, 4);
  assert.equal(bill.missedPeriods, 1, "March is a period with no charge in it");
  assert.equal(bill.nextExpectedDate, "2026-06-15");
});

test("a skipped month costs confidence against an otherwise identical history", () => {
  const clean = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"]);
  seq = 0;
  const skipped = monthlyOn15th(["2026-01", "2026-02", "2026-04", "2026-05"]);

  const a = only(detectRecurringBills(clean, { now: "2026-05-20" }).bills);
  const b = only(detectRecurringBills(skipped, { now: "2026-05-20" }).bills);

  assert.ok(
    b.confidencePct < a.confidencePct,
    `a gap must cost confidence: clean ${a.confidencePct} vs skipped ${b.confidencePct}`
  );
});

test("two skipped months in a row still detect, with the missed periods counted", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-05", "2026-06", "2026-07"]);
  const bill = only(detectRecurringBills(rows, { now: "2026-07-20" }).bills);
  assert.equal(bill.cadence, "monthly");
  assert.equal(bill.missedPeriods, 2);
});

/* ========================================================================= *
 * A changed amount
 * ========================================================================= */

test("a price rise mid-history still detects, and reports the median not the mean", () => {
  const rows = [
    tx("2026-01-15", -1599), tx("2026-02-15", -1599), tx("2026-03-15", -1999),
    tx("2026-04-15", -1999), tx("2026-05-15", -1999)
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-05-20" }).bills);

  assert.equal(bill.typicalAmountCents, -1999, "median of the five, which is a real charge");
  assert.equal(bill.amountMinCents, -1999);
  assert.equal(bill.amountMaxCents, -1599);
  assert.equal(bill.amountSpreadPct, 20);
  assert.equal(bill.nextExpectedDate, "2026-06-15");
});

test("a wildly varying amount costs confidence but is not silently dropped", () => {
  const steady = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"], -10000);
  seq = 0;
  const wild = [
    tx("2026-01-15", -10000), tx("2026-02-15", -30000),
    tx("2026-03-15", -10000), tx("2026-04-15", -80000)
  ];

  const a = only(detectRecurringBills(steady, { now: "2026-04-20" }).bills);
  const b = detectRecurringBills(wild, { now: "2026-04-20" });
  const varying = only([...b.bills, ...b.candidates]);

  assert.ok(varying.amountSpreadPct > 25);
  assert.ok(
    varying.confidencePct < a.confidencePct,
    "an amount that varies sevenfold is weaker evidence of one bill"
  );
});

test("an outlier does not drag the typical amount somewhere the client was never charged", () => {
  const rows = [
    tx("2026-01-15", -1200), tx("2026-02-15", -1200), tx("2026-03-15", -1200),
    tx("2026-04-15", -1200), tx("2026-05-15", -30000)
  ];
  const r = detectRecurringBills(rows, { now: "2026-05-20" });
  const found = only([...r.bills, ...r.candidates]);
  assert.equal(found.typicalAmountCents, -1200, "the median ignores the outlier; a mean would not");
});

/* ========================================================================= *
 * Duplicate provider ids
 * ========================================================================= */

test("the same provider id twice is counted once — a re-sync cannot double-count", () => {
  const base = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  // Exactly what an overlapping sync window produces: the same rows again.
  const rows = [...base, ...base.map((r) => ({ ...r }))];

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  const bill = only(r.bills);
  assert.equal(bill.occurrenceCount, 3, "*** six rows, three transactions ***");
  assert.equal(bill.typicalAmountCents, -1599);
  assert.equal(r.excluded.length, 3);
  for (const e of r.excluded) assert.equal(e.reason, EXCLUSION_REASONS.DUPLICATE);
});

test("a duplicate re-sync produces exactly the same answer as a clean one", () => {
  const base = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"]);
  const clean = detectRecurringBills(base, { now: "2026-04-20" });
  const doubled = detectRecurringBills([...base, ...base.map((r) => ({ ...r }))], { now: "2026-04-20" });

  assert.deepEqual(
    doubled.bills.map((b) => ({ ...b, evidenceTransactionIds: null, evidenceProviderIds: null })),
    clean.bills.map((b) => ({ ...b, evidenceTransactionIds: null, evidenceProviderIds: null }))
  );
});

test("the same provider id on a DIFFERENT account is not a duplicate", () => {
  // Two banks can both hand out the id "1". Deduping globally would silently
  // delete one account's transaction — the reason uq_bank_transactions_account_provider
  // is scoped to the account.
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]).map((r, i) => ({
      ...r, provider_transaction_id: `shared-${i}`
    })),
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]).map((r, i) => ({
      ...r, bank_account_id: ACCOUNT_B, provider_transaction_id: `shared-${i}`
    }))
  ];

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  assert.deepEqual(r.excluded, []);
  assert.equal(r.bills.length, 2);
  assert.deepEqual(r.bills.map((b) => b.bankAccountId).sort(), [ACCOUNT_A, ACCOUNT_B].sort());
});

test("a row with no provider id is excluded — you can only dedupe what you can identify", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]),
    tx("2026-02-20", -500, { provider_transaction_id: null }),
    tx("2026-02-21", -500, { provider_transaction_id: "   " })
  ];

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  assert.equal(r.excluded.filter((e) => e.reason === EXCLUSION_REASONS.NO_PROVIDER_ID).length, 2);
  assert.equal(only(r.bills).occurrenceCount, 3);
});

/* ========================================================================= *
 * Exclusions — nothing is dropped silently
 * ========================================================================= */

test("pending rows are excluded — a hold that re-posts would manufacture a cadence", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]),
    tx("2026-03-16", -1599, { is_pending: true, provider_transaction_id: "pending-1" })
  ];

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  assert.equal(only(r.bills).occurrenceCount, 3);
  const ex = only(r.excluded);
  assert.equal(ex.reason, EXCLUSION_REASONS.PENDING);
  assert.equal(ex.providerTransactionId, "pending-1");
});

test("every unusable row shape gets its own named reason and none of them throw", () => {
  const rows = [
    null,
    "not a row",
    [],
    tx("2026-01-15", -100, { bank_account_id: null }),
    tx("2026-01-15", -100, { provider_transaction_id: "" }),
    tx("2026-01-15", 0),
    tx("2026-01-15", -10.5),
    tx("2026-01-15", "12.34"),
    tx("2026-01-15", 4200),
    tx(null, -100),
    tx("not-a-date", -100),
    tx("2026-02-30", -100),
    tx("2026-01-15", -100, { merchant_name: null }),
    tx("2026-01-15", -100, { merchant_name: "   " }),
    tx("2026-01-15", -100, { is_pending: true })
  ];

  const r = detectRecurringBills(rows, { now: "2026-06-01" });

  assert.deepEqual(r.bills, []);
  assert.equal(r.excluded.length, rows.length, "every row accounted for");
  assert.deepEqual(r.excluded.map((e) => e.reason), [
    EXCLUSION_REASONS.NOT_AN_OBJECT,
    EXCLUSION_REASONS.NOT_AN_OBJECT,
    EXCLUSION_REASONS.NOT_AN_OBJECT,
    EXCLUSION_REASONS.NO_ACCOUNT,
    EXCLUSION_REASONS.NO_PROVIDER_ID,
    EXCLUSION_REASONS.ZERO,
    EXCLUSION_REASONS.NOT_INTEGER_CENTS,
    EXCLUSION_REASONS.NOT_INTEGER_CENTS,
    EXCLUSION_REASONS.INFLOW,
    EXCLUSION_REASONS.NO_DATE,
    EXCLUSION_REASONS.BAD_DATE,
    EXCLUSION_REASONS.BAD_DATE,
    EXCLUSION_REASONS.NO_MERCHANT,
    EXCLUSION_REASONS.NO_MERCHANT,
    EXCLUSION_REASONS.PENDING
  ]);
  for (const e of r.excluded) assert.equal(typeof e.index, "number");
});

test("a bigint arriving from pg as a numeric STRING is accepted; a decimal one is not", () => {
  // node-postgres returns bigint as a string. "-1599" is integer cents; "-15.99"
  // means somebody put dollars in a cents column, and coercing it would
  // understate the bill a hundredfold.
  const rows = [
    tx("2026-01-15", "-1599"), tx("2026-02-15", "-1599"), tx("2026-03-15", "-1599")
  ];
  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);
  assert.equal(bill.typicalAmountCents, -1599);

  const bad = detectRecurringBills([tx("2026-01-15", "-15.99")], { now: "2026-03-20" });
  assert.equal(only(bad.excluded).reason, EXCLUSION_REASONS.NOT_INTEGER_CENTS);
});

test("authorized_on is NEVER substituted for a missing posted_on", () => {
  // Mixing settlement dates with authorisation dates wobbles a cadence by
  // exactly the one-to-three days that turn a clean bill into an irregular one.
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]).map((r) => ({
    ...r, posted_on: null, authorized_on: r.posted_on
  }));

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  assert.deepEqual(r.bills, []);
  assert.equal(r.excluded.length, 3);
  for (const e of r.excluded) assert.equal(e.reason, EXCLUSION_REASONS.NO_DATE);
});

/* ========================================================================= *
 * `now` is a required parameter and there is no clock in the module
 * ========================================================================= */

test("detectRecurringBills refuses to run without `now`", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  assert.throws(() => detectRecurringBills(rows), /`now` is required/);
  assert.throws(() => detectRecurringBills(rows, {}), /`now` is required/);
  assert.throws(() => detectRecurringBills(rows, { now: null }), /`now` is required/);
  assert.throws(() => detectRecurringBills(rows, { now: "yesterday" }), /unparseable/);
});

test("`now` changes the answer, which is exactly why it is a parameter", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04"]);

  const soon = only(detectRecurringBills(rows, { now: "2026-04-20" }).bills);
  const later = detectRecurringBills(rows, { now: "2027-04-20" });

  assert.equal(soon.nextExpectedDate, "2026-05-15");
  assert.deepEqual(later.bills, [], "a year of silence is not a live bill");
  assert.equal(only(later.candidates).nextExpectedDate, null);
});

test("the same rows and the same `now` always give the same answer", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]),
    ...["2026-02-01", "2026-02-08", "2026-02-15"].map((d) => tx(d, -800, { merchant_name: "GYM" }))
  ];
  const a = detectRecurringBills(rows, { now: "2026-03-20" });
  const b = detectRecurringBills([...rows].reverse(), { now: "2026-03-20" });

  const strip = (x) => x.bills.map((bill) => ({
    ...bill, evidenceTransactionIds: null, evidenceProviderIds: null
  }));
  assert.deepEqual(strip(b), strip(a), "input order must not change the answer");
});

test("`now` may be a Date, and detectedAsOf preserves the instant it was given", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  const at = new Date("2026-03-20T14:30:00.000Z");

  const r = detectRecurringBills(rows, { now: at });

  assert.equal(r.detectedAsOf, at.toISOString());
  assert.equal(only(r.bills).detectedAsOf, at.toISOString());
});

test("detection does not mutate its input rows", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  const before = JSON.stringify(rows);

  detectRecurringBills(rows, { now: "2026-03-20" });

  assert.equal(JSON.stringify(rows), before);
});

/* ========================================================================= *
 * Grouping
 * ========================================================================= */

test("different merchants are different bills; the same merchant on two accounts is two", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"], -1000, { merchant_name: "NETFLIX" }),
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"], -2000, { merchant_name: "SPOTIFY" }),
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"], -3000,
      { merchant_name: "NETFLIX", bank_account_id: ACCOUNT_B })
  ];

  const r = detectRecurringBills(rows, { now: "2026-03-20" });

  assert.equal(r.bills.length, 3);
  const keys = r.bills.map((b) => `${b.bankAccountId === ACCOUNT_A ? "A" : "B"}:${b.merchantKey}`);
  assert.deepEqual(keys.sort(), ["A:NETFLIX", "A:SPOTIFY", "B:NETFLIX"]);
});

test("store numbers in the raw descriptor do not split one merchant into three", () => {
  const rows = [
    tx("2026-01-06", -1450, { merchant_name: "SQ *BLUE BOTTLE 4471 OAKLAND CA" }),
    tx("2026-02-06", -1450, { merchant_name: "SQ *BLUE BOTTLE 8813 OAKLAND CA" }),
    tx("2026-03-06", -1450, { merchant_name: "SQ *BLUE BOTTLE 2210 OAKLAND CA" })
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-03-10" }).bills);

  assert.equal(bill.merchantKey, "BLUE BOTTLE OAKLAND CA");
  assert.equal(bill.merchantDisplay, "SQ *BLUE BOTTLE 4471 OAKLAND CA", "a raw example is kept");
  assert.equal(bill.occurrenceCount, 3);
});

test("accountIds narrows detection without the caller having to pre-filter rows", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"]),
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03"], -5000, { bank_account_id: ACCOUNT_B })
  ];

  const r = detectRecurringBills(rows, { now: "2026-03-20", accountIds: [ACCOUNT_B] });

  assert.equal(only(r.bills).bankAccountId, ACCOUNT_B);
});

test("two charges at one merchant on one day are one occurrence, and both stay as evidence", () => {
  // Nothing in the data says whether this is one bill double-posted or two
  // separate purchases, so the module does not guess: a day is a day.
  const rows = [
    tx("2026-01-15", -1599), tx("2026-01-15", -1599),
    tx("2026-02-15", -1599), tx("2026-03-15", -1599)
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);

  assert.equal(bill.occurrenceCount, 3, "three days, not four charges");
  assert.equal(bill.sameDayCollapsedDays, 1, "and the collapse is reported, not hidden");
  assert.equal(bill.evidenceTransactionIds.length, 4, "all four transactions remain evidence");
  assert.equal(bill.cadence, "monthly");
});

/* ========================================================================= *
 * is_business is never inferred
 * ========================================================================= */

test("is_business is null with a reason when the caller supplies no account fact", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"], -49900,
    { merchant_name: "AWS BILLING" });

  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);

  assert.equal(bill.isBusiness, null, "a business-sounding merchant is not a business fact");
  assert.equal(bill.isBusinessUnknownReason, REASONS.NO_ACCOUNT_BUSINESS_FLAG);
});

test("is_business is set only from the caller's account-level map, and false is honoured", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);

  const yes = only(detectRecurringBills(rows, {
    now: "2026-03-20", accountIsBusiness: { [ACCOUNT_A]: true }
  }).bills);
  const no = only(detectRecurringBills(rows, {
    now: "2026-03-20", accountIsBusiness: { [ACCOUNT_A]: false }
  }).bills);
  const other = only(detectRecurringBills(rows, {
    now: "2026-03-20", accountIsBusiness: { [ACCOUNT_B]: true }
  }).bills);

  assert.equal(yes.isBusiness, true);
  assert.equal(yes.isBusinessUnknownReason, null);
  assert.equal(no.isBusiness, false, "false is a fact, not an absence");
  assert.equal(no.isBusinessUnknownReason, null);
  assert.equal(other.isBusiness, null, "a flag for a different account says nothing about this one");
  assert.equal(other.isBusinessUnknownReason, REASONS.NO_ACCOUNT_BUSINESS_FLAG);
});

test("a non-boolean in the business map is ignored rather than coerced", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  for (const junk of ["yes", 1, 0, null, {}]) {
    const bill = only(detectRecurringBills(rows, {
      now: "2026-03-20", accountIsBusiness: { [ACCOUNT_A]: junk }
    }).bills);
    assert.equal(bill.isBusiness, null, `"${String(junk)}" is not a boolean`);
  }
});

/* ========================================================================= *
 * The presentable / not-presentable split
 * ========================================================================= */

test("nothing in `bills` is ever below medium, and nothing in `candidates` is ever above low", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]),
    ...["2026-05-01", "2026-06-01"].map((d) => tx(d, -2200, { merchant_name: "GYM" })),
    ...["2026-01-03", "2026-01-19", "2026-02-27", "2026-04-30"]
      .map((d) => tx(d, -1234, { merchant_name: "ODDS" }))
  ];

  const r = detectRecurringBills(rows, { now: "2026-06-20" });

  assert.ok(r.bills.length > 0 && r.candidates.length > 0, "this fixture must exercise both");
  for (const b of r.bills) assert.ok(PRESENTABLE_LABELS.includes(b.confidenceLabel));
  for (const c of r.candidates) assert.equal(c.confidenceLabel, "low");
});

test("confidence is always an integer inside the stated range", () => {
  const rows = [
    ...monthlyOn15th(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]),
    ...["2026-05-01", "2026-06-02"].map((d) => tx(d, -2200, { merchant_name: "GYM" }))
  ];
  const r = detectRecurringBills(rows, { now: "2026-07-20" });

  for (const item of [...r.bills, ...r.candidates]) {
    assert.ok(Number.isInteger(item.confidencePct), "no floats — thresholds must compare exactly");
    assert.ok(item.confidencePct >= 0 && item.confidencePct <= 95,
      "nothing inferred from a history is certain, so 100 is unreachable");
  }
});

test("an empty input is an empty answer, not an error", () => {
  const r = detectRecurringBills([], { now: "2026-06-20" });
  assert.deepEqual(r, {
    detectedAsOf: "2026-06-20T00:00:00.000Z",
    bills: [], candidates: [], rejected: [], excluded: []
  });
  assert.throws(() => detectRecurringBills(null, { now: "2026-06-20" }), /must be an array/);
});

/* ========================================================================= *
 * normaliseMerchant
 * ========================================================================= */

test("normaliseMerchant strips identifiers and keeps names", () => {
  const cases = [
    ["SQ *BLUE BOTTLE 4471 OAKLAND CA", "BLUE BOTTLE OAKLAND CA"],
    ["SQ *BLUE BOTTLE 8813 OAKLAND CA", "BLUE BOTTLE OAKLAND CA"],
    ["NETFLIX.COM", "NETFLIX COM"],
    ["netflix.com", "NETFLIX COM"],
    ["  Netflix.com  ", "NETFLIX COM"],
    ["ACH DEBIT PG&E 0603 REF#99182", "PG E"],
    ["RECURRING PAYMENT SPOTIFY USA", "SPOTIFY USA"],
    ["POS PURCHASE WHOLE FOODS #10259", "WHOLE FOODS"],
    ["CHECKCARD 0417 XXXX1234 HULU", "HULU"]
  ];
  for (const [raw, expected] of cases) {
    assert.equal(normaliseMerchant(raw), expected, raw);
  }
});

test("normaliseMerchant does not eat a name that merely starts with a noise word", () => {
  // "POS" is noise; "POSTMATES" is a merchant. Whole-word removal only.
  assert.equal(normaliseMerchant("POSTMATES *ORDER"), "POSTMATES ORDER");
  assert.equal(normaliseMerchant("PAYPAL *WIKIMEDIA"), "WIKIMEDIA");
  assert.equal(normaliseMerchant("AUTOZONE 4412"), "AUTOZONE");
});

test("normaliseMerchant returns empty for anything with no name in it", () => {
  for (const raw of ["", "   ", "1234 5678", "###", null, undefined, 42, {}]) {
    assert.equal(normaliseMerchant(raw), "", JSON.stringify(raw));
  }
});

test("normaliseMerchant keeps a name made only of a noise word rather than erasing it", () => {
  assert.equal(normaliseMerchant("TRANSFER"), "TRANSFER");
});

test("normalisation does not merge two genuinely different merchants", () => {
  // Over-normalising is the dangerous direction: a merged group produces a
  // confident bill for something nobody pays.
  assert.notEqual(normaliseMerchant("BLUE BOTTLE"), normaliseMerchant("BLUE APRON"));
  assert.notEqual(normaliseMerchant("STATE FARM"), normaliseMerchant("STATE ST"));
  assert.notEqual(normaliseMerchant("ADOBE MONTHLY"), normaliseMerchant("ADOBE ANNUAL"));
});

/* ========================================================================= *
 * Helpers
 * ========================================================================= */

test("medianCents is an integer and rounds the way the rest of the money code does", () => {
  assert.equal(medianCents([]), null);
  assert.equal(medianCents([500]), 500);
  assert.equal(medianCents([300, 100, 200]), 200);
  assert.equal(medianCents([100, 200]), 150);
  assert.equal(medianCents([100, 201]), 151, "half away from zero");
  assert.equal(medianCents([-100, -201]), -151, "and symmetrically for outflows");
  assert.ok(Number.isInteger(medianCents([-1599, -1999])));
});

test("parseDay accepts the shapes a row actually arrives in, and rejects the rest", () => {
  assert.deepEqual(parseDay("2026-03-15"), { y: 2026, m: 3, d: 15 });
  assert.deepEqual(parseDay("2026-03-15T22:00:00.000Z"), { y: 2026, m: 3, d: 15 });
  assert.deepEqual(parseDay(new Date(2026, 2, 15)), { y: 2026, m: 3, d: 15 });
  assert.equal(parseDay("2026-02-30"), null, "a date nobody could be billed on is a parse failure");
  assert.equal(parseDay("2026-13-01"), null);
  assert.equal(parseDay("15/03/2026"), null);
  assert.equal(parseDay(new Date("nonsense")), null);
  assert.equal(parseDay(null), null);
  assert.equal(parseDay(1_772_000_000_000), null, "an epoch number is not a day");
  assert.equal(formatDay({ y: 2026, m: 3, d: 5 }), "2026-03-05");
});

test("month-end bills anchor on the real billing day, not on February's clamp", () => {
  // MUTATION-CHECKED. The LAST occurrence here is deliberately the CLAMPED one
  // (February 28th). A detector that anchored on the last occurrence's
  // day-of-month would answer 2026-03-28 and pin a bill that is really charged
  // on the 31st to the 28th for ever after. Anchoring on the largest observed
  // day-of-month recovers the real billing day.
  const rows = [
    tx("2025-12-31", -5000), tx("2026-01-31", -5000), tx("2026-02-28", -5000)
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-03-02" }).bills);

  assert.equal(bill.cadence, "monthly");
  assert.equal(bill.nextExpectedDate, "2026-03-31", "the 31st, not February's clamped 28th");
});

test("a month-end anchor still clamps down for a genuinely shorter month", () => {
  const rows = [
    tx("2026-01-31", -5000), tx("2026-02-28", -5000),
    tx("2026-03-31", -5000), tx("2026-05-31", -5000)
  ];

  const bill = only(detectRecurringBills(rows, { now: "2026-06-02" }).bills);

  assert.equal(bill.nextExpectedDate, "2026-06-30", "June has 30 days, so the 31st clamps to it");
});

/* ========================================================================= *
 * toBillRow — the mapping to migration 086's columns
 * ========================================================================= */

test("toBillRow produces exactly the columns migration 086 declares", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);

  const shaped = toBillRow(bill, { orgId: ORG });

  assert.deepEqual(Object.keys(shaped).sort(), [
    "bank_account_id", "cadence", "client_id", "confidence_label", "confidence_pct",
    "detected_as_of", "first_seen_on", "is_business", "last_seen_on", "merchant_display",
    "merchant_key", "next_expected_on", "next_expected_unknown_reason", "occurrence_count",
    "org_id", "typical_amount_cents"
  ]);
  assert.equal(shaped.org_id, ORG);
  assert.equal(shaped.bank_account_id, ACCOUNT_A);
  assert.equal(shaped.typical_amount_cents, -1599);
  assert.equal(shaped.cadence, "monthly");
  assert.equal(shaped.next_expected_on, "2026-04-15");
  assert.equal(shaped.next_expected_unknown_reason, null);
  assert.equal(shaped.is_business, null);
});

test("toBillRow refuses an org-less write and refuses a bill that is not an outflow", () => {
  const rows = monthlyOn15th(["2026-01", "2026-02", "2026-03"]);
  const bill = only(detectRecurringBills(rows, { now: "2026-03-20" }).bills);

  assert.throws(() => toBillRow(bill, {}), /orgId is required/);
  assert.throws(
    () => toBillRow({ ...bill, typicalAmountCents: 1599 }, { orgId: ORG }),
    /must be an outflow/,
    "the last line of defence before migration 086's CHECK"
  );
});

test("toBillRow carries a null next date together with its reason, never one alone", () => {
  const rows = monthlyOn15th(["2026-05", "2026-06"]);
  const candidate = only(detectRecurringBills(rows, { now: "2026-06-20" }).candidates);

  const shaped = toBillRow(candidate, { orgId: ORG });

  assert.equal(shaped.next_expected_on, null);
  assert.equal(shaped.next_expected_unknown_reason, REASONS.TWO_OCCURRENCES);
  assert.equal(
    (shaped.next_expected_on === null) !== (shaped.next_expected_unknown_reason === null),
    true,
    "recurring_bills_next_expected_reason_ck would reject anything else"
  );
});
