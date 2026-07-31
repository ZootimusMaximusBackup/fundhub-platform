// Unit tests for recurring bill detection. Pure functions, no database.
//
// The headline test in this file is "two payments never score high". Everything
// else supports it. A detector that scores a two-point pattern 0.95 because the
// interval variance is mathematically zero is worse than no detector at all,
// because the screen renders it in the same type as a twelve-month insurance
// bill and somebody plans their month around a coincidence.

import { test } from "node:test";
import assert from "node:assert";
import { detectRecurring, confidenceLabel } from "./recurring.mjs";

/* A payment. Amount is given positive for readability and negated here, because
   085's convention is that outflows are negative. */
const pay = (merchant, dollars, postedDate, extra = {}) =>
  ({ merchantName: merchant, amountCents: -Math.round(dollars * 100), postedDate, ...extra });

/* n monthly payments of the same amount, starting at a fixed date. */
function monthly(merchant, dollars, count, startDay = 1) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(2026, i, startDay));
    out.push(pay(merchant, dollars, d.toISOString().slice(0, 10)));
  }
  return out;
}

const only = (r) => { assert.equal(r.bills.length, 1, "expected exactly one bill"); return r.bills[0]; };

/* ------------------------- the rule that matters -------------------------- */

test("TWO PAYMENTS NEVER SCORE HIGH, NO MATTER HOW PERFECT THEY LOOK", () => {
  const b = only(detectRecurring({ transactions: monthly("Perfect Co", 100, 2) }));
  assert.equal(b.occurrenceCount, 2);
  assert.ok(b.confidence <= 0.35,
    `two identical monthly payments scored ${b.confidence} — two points always make a perfect line`);
  assert.equal(confidenceLabel(b.confidence), "low");
  assert.equal(b.evidence.cappedByOccurrenceCount, true,
    "the row must be able to explain why a flawless-looking pattern scored low");
});

test("confidence rises with evidence, and only with evidence", () => {
  const scores = [2, 3, 4, 5, 6, 12].map(
    (n) => only(detectRecurring({ transactions: monthly("Steady Co", 100, n) })).confidence
  );
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] >= scores[i - 1], `confidence fell going from ${i + 1} to ${i + 2} occurrences`);
  }
  assert.ok(scores[0] < scores.at(-1), "twelve payments must beat two");
});

test("CONFIDENCE NEVER REACHES 1", () => {
  const b = only(detectRecurring({ transactions: monthly("Immortal Co", 100, 60) }));
  assert.ok(b.confidence < 1, `scored ${b.confidence} — the next occurrence may simply not happen`);
  assert.ok(b.confidence <= 0.95);
});

test("a single payment is not a pattern and is not emitted", () => {
  const r = detectRecurring({ transactions: [pay("One Off", 50, "2026-03-01")] });
  assert.deepEqual(r.bills, []);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /only 1 payment/);
});

test("SKIPPED MERCHANTS ARE REPORTED — 'no bills' and 'nothing to look at' differ", () => {
  const r = detectRecurring({ transactions: [pay("One Off", 50, "2026-03-01")] });
  assert.equal(r.bills.length, 0);
  assert.ok(r.skipped.length > 0, "a caller must be able to tell these apart");
});

/* --------------------------- signals and vetoes --------------------------- */

test("WILDLY VARYING AMOUNTS VETO CONFIDENCE EVEN ON A PERFECT INTERVAL", () => {
  const steady = only(detectRecurring({ transactions: monthly("Utility", 100, 12) }));
  const varying = only(detectRecurring({
    transactions: [10, 400, 15, 380, 20, 350, 12, 390, 18, 360, 25, 370].map(
      (d, i) => pay("Utility", d, new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 10)))
  }));
  assert.ok(varying.confidence < steady.confidence / 2,
    "averaging the signals would let a perfect interval carry wildly varying amounts");
});

test("an irregular interval is labelled irregular, not rounded to monthly", () => {
  const b = only(detectRecurring({
    transactions: [
      pay("Chaos Co", 40, "2026-01-03"), pay("Chaos Co", 40, "2026-02-19"),
      pay("Chaos Co", 40, "2026-03-04"), pay("Chaos Co", 40, "2026-05-27")
    ]
  }));
  assert.equal(b.cadence, "irregular");
  assert.equal(b.nextExpectedDate, null,
    "projecting from an irregular cadence is arithmetic performed on an admission of ignorance");
});

test("a 47-day average is irregular, not 'monthly, roughly'", () => {
  const b = only(detectRecurring({
    transactions: [
      pay("Odd Co", 60, "2026-01-01"), pay("Odd Co", 60, "2026-02-17"),
      pay("Odd Co", 60, "2026-04-05"), pay("Odd Co", 60, "2026-05-22")
    ]
  }));
  assert.equal(b.cadence, "irregular");
});

test("the real cadences are recognised", () => {
  const weekly = only(detectRecurring({
    transactions: ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"].map((d) => pay("Weekly Co", 20, d))
  }));
  assert.equal(weekly.cadence, "weekly");

  const biweekly = only(detectRecurring({
    transactions: ["2026-01-02", "2026-01-16", "2026-01-30", "2026-02-13", "2026-02-27"].map((d) => pay("Fortnight Co", 75, d))
  }));
  assert.equal(biweekly.cadence, "biweekly");

  assert.equal(only(detectRecurring({ transactions: monthly("Monthly Co", 30, 6) })).cadence, "monthly");
});

/* ------------------------------ the projection ---------------------------- */

test("a monthly bill projects the next date from the last payment", () => {
  const b = only(detectRecurring({ transactions: monthly("Insurance Co", 87.4, 12) }));
  assert.equal(b.lastSeenDate, "2026-12-01");
  assert.equal(b.nextExpectedDate, "2026-12-31", "last payment plus one monthly period");
});

test("the projection has no clock — the same input gives the same output", () => {
  const t = monthly("Insurance Co", 87.4, 6);
  assert.deepEqual(detectRecurring({ transactions: t }), detectRecurring({ transactions: t }));
});

/* ----------------------------- what is counted ---------------------------- */

test("MONEY COMING IN IS NOT AN INSTANCE OF A BILL", () => {
  const r = detectRecurring({
    transactions: [
      ...monthly("Store", 50, 3),
      { merchantName: "Store", amountCents: 5000, postedDate: "2026-02-15" }  // a refund
    ]
  });
  const b = only(r);
  assert.equal(b.occurrenceCount, 3, "a refund would both inflate the count and corrupt the gaps");
});

test("pending transactions are excluded by default and can be opted in", () => {
  const t = [...monthly("Sub Co", 12, 3), pay("Sub Co", 12, "2026-04-01", { pending: true })];
  assert.equal(only(detectRecurring({ transactions: t })).occurrenceCount, 3);
  assert.equal(only(detectRecurring({ transactions: t, includePending: true })).occurrenceCount, 4);
});

test("same-day duplicates do not fake a perfect cadence", () => {
  const r = detectRecurring({
    transactions: [pay("Dupe Co", 10, "2026-01-01"), pay("Dupe Co", 10, "2026-01-01")]
  });
  assert.deepEqual(r.bills, []);
  assert.match(r.skipped[0].reason, /same day/);
});

test("merchants are grouped case- and whitespace-insensitively", () => {
  const b = only(detectRecurring({
    transactions: [
      pay("Netflix", 15.49, "2026-01-07"), pay("NETFLIX  ", 15.49, "2026-02-07"),
      pay("  netflix", 15.49, "2026-03-07")
    ]
  }));
  assert.equal(b.occurrenceCount, 3);
});

test("different merchants are never merged into one bill", () => {
  const r = detectRecurring({
    transactions: [...monthly("Netflix", 15.49, 4), ...monthly("Hulu", 17.99, 4)]
  });
  assert.equal(r.bills.length, 2, "grouping by category would make two subscriptions one confident bill");
});

test("transactions missing an amount, a date or a merchant are ignored, not guessed", () => {
  const r = detectRecurring({
    transactions: [
      ...monthly("Good Co", 20, 3),
      { merchantName: "Bad Co", amountCents: null, postedDate: "2026-01-01" },
      { merchantName: "Bad Co", amountCents: -2000, postedDate: "not a date" },
      { merchantName: null, amountCents: -2000, postedDate: "2026-01-01" }
    ]
  });
  assert.equal(r.bills.length, 1);
  assert.equal(r.bills[0].merchantName, "Good Co");
});

test("an empty ledger yields nothing and does not throw", () => {
  assert.deepEqual(detectRecurring({}), { bills: [], skipped: [] });
  assert.deepEqual(detectRecurring({ transactions: [] }), { bills: [], skipped: [] });
});

/* ----------------------------- the output shape --------------------------- */

test("a bill carries the evidence it was computed from", () => {
  const b = only(detectRecurring({ transactions: monthly("Evidence Co", 42, 5) }));
  assert.equal(b.evidence.gaps.length, 4);
  assert.equal(b.evidence.amounts.length, 5);
  assert.ok("intervalScore" in b.evidence && "amountScore" in b.evidence && "rawScore" in b.evidence,
    "a guess nobody can check is a guess nobody should act on");
});

test("the stored amount is positive — an obligation, not a ledger entry", () => {
  const b = only(detectRecurring({ transactions: monthly("Positive Co", 87.4, 4) }));
  assert.equal(b.amountCents, 8740, "'your bill is negative eighty-seven dollars' is not a sentence anybody should read");
  assert.equal(b.amountVarianceCents, 0);
});

test("a varying bill reports its variance rather than implying a fixed figure", () => {
  const b = only(detectRecurring({
    transactions: [100, 120, 110, 130, 105, 125].map(
      (d, i) => pay("Water Co", d, new Date(Date.UTC(2026, i, 8)).toISOString().slice(0, 10)))
  }));
  assert.ok(b.amountVarianceCents > 0);
});

test("an account is only named when every payment came from the same one", () => {
  const same = only(detectRecurring({
    transactions: monthly("A Co", 10, 3).map((t) => ({ ...t, bankAccountId: "acct-1" }))
  }));
  assert.equal(same.bankAccountId, "acct-1");

  const mixed = only(detectRecurring({
    transactions: monthly("A Co", 10, 3).map((t, i) => ({ ...t, bankAccountId: i ? "acct-2" : "acct-1" }))
  }));
  assert.equal(mixed.bankAccountId, null, "forcing one would be a guess about a guess");
});

test("bills come back most-trusted first", () => {
  const r = detectRecurring({
    transactions: [...monthly("Weak Co", 10, 2), ...monthly("Strong Co", 10, 12)]
  });
  assert.equal(r.bills[0].merchantName, "Strong Co");
});

/* ---------------------------- confidenceLabel ----------------------------- */

test("confidence bands are defined in one place so 'low' means one thing", () => {
  assert.equal(confidenceLabel(0.1), "low");
  assert.equal(confidenceLabel(0.39), "low");
  assert.equal(confidenceLabel(0.4), "medium");
  assert.equal(confidenceLabel(0.69), "medium");
  assert.equal(confidenceLabel(0.7), "high");
  assert.equal(confidenceLabel(null), "unknown");
  assert.equal(confidenceLabel(undefined), "unknown");
});

test("every emitted confidence is storable by the 086 CHECK", () => {
  const r = detectRecurring({
    transactions: [...monthly("A", 10, 2), ...monthly("B", 20, 3), ...monthly("C", 30, 24)]
  });
  for (const b of r.bills) {
    assert.ok(b.confidence >= 0 && b.confidence < 1, `${b.merchantName} scored ${b.confidence}`);
  }
});
