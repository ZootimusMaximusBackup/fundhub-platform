// Unit tests for the liability normalizer. No database — this half is pure.
//
// The tests that matter here are the REFUSALS and the SURVIVAL OF NULL.
// This module feeds a screen that tells a consumer what they owe and what they
// must pay. Every failure mode worth testing is a case where a plausible-looking
// value must not be accepted, or where an unknown must not quietly become zero.
// A minimum payment rendered as $0 because a bureau file omitted it is not a
// slightly wrong report — it is us telling someone nothing is due.

import { test } from "node:test";
import assert from "node:assert";
import {
  toCents, fromCents, readApr, readDate, readPaymentStatus,
  normalizeLiability, normalizeLiabilitiesFromCrs, accountRefOf
} from "./index.mjs";

const ASOF = "2026-06-30";

// ---------------------------------------------------------------------------
// APR — the single reader, reused from tradelines. These assertions exist to
// prove the reuse is real: if someone drops a second readApr in here, the
// percentage/fraction contract is what will drift first.
// ---------------------------------------------------------------------------

test("readApr is the tradeline reader — a fraction in [0,1], never a percentage", () => {
  assert.equal(readApr(18.99), 0.1899, "a number above 1 is a percentage number");
  assert.equal(readApr(0.1899), 0.1899, "a number at or below 1 is already a fraction");
  assert.equal(readApr("24.99%"), 0.2499);
  assert.equal(readApr(0), 0, "a 0% intro rate is a real rate, not a missing one");
});

test("readApr refuses rather than clamps what it cannot read", () => {
  assert.equal(readApr(null), null);
  assert.equal(readApr(""), null);
  assert.equal(readApr("variable"), null);
  assert.equal(readApr(-4), null);
  assert.equal(readApr(150), null, "150% is outside the range we will act on");
});

test("normalized APR is always a decimal fraction inside the column's CHECK range", () => {
  for (const input of [18.99, 0.1899, "29.99%", 0, 1, 100]) {
    const row = normalizeLiability({ balance: 100, apr: input }, { asOf: ASOF });
    assert.ok(row.apr >= 0 && row.apr <= 1,
      `apr ${row.apr} from ${input} must satisfy CHECK (apr >= 0 AND apr <= 1)`);
  }
});

// ---------------------------------------------------------------------------
// Money — integer cents, and NULL survives.
// ---------------------------------------------------------------------------

test("money reads as integer cents, matching the bigint columns", () => {
  const row = normalizeLiability(
    { statement_balance: "1,234.56", minimum_payment: "$35", past_due: 0 },
    { asOf: ASOF }
  );
  assert.equal(row.statement_balance_cents, 123456, "cents, not dollars, not a float");
  assert.equal(row.minimum_payment_cents, 3500);
  assert.equal(row.past_due_cents, 0, "a REPORTED zero past-due is a fact and is kept");
  assert.equal(fromCents(row.statement_balance_cents), 1234.56, "round-trips without drift");
});

test("an omitted minimum payment stays NULL and never becomes zero", () => {
  const row = normalizeLiability({ balance: 500, statement_balance: 480 }, { asOf: ASOF });
  assert.equal(row.minimum_payment_cents, null,
    "unknown minimum must survive — $0 would tell a client nothing is due");
  assert.notEqual(row.minimum_payment_cents, 0);
});

test("every unreported measure is NULL, not zero", () => {
  const row = normalizeLiability({ balance: 100 }, { asOf: ASOF });
  for (const k of [
    "statement_balance_cents", "minimum_payment_cents", "past_due_cents",
    "last_payment_cents", "last_payment_date", "statement_date",
    "payment_due_date", "apr", "payment_status"
  ]) {
    assert.equal(row[k], null, `${k} must be null when the file does not report it`);
  }
  assert.equal(row.current_balance_cents, 10000);
});

test("a negative money value reads as unknown rather than as a negative", () => {
  // Same contract as toCents in the tradeline normalizer: the bigint columns
  // carry CHECK (>= 0), so a credit balance is stored as "we do not know"
  // rather than smuggled past the constraint.
  assert.equal(toCents(-50), null);
  const row = normalizeLiability({ balance: 100, past_due: -25 }, { asOf: ASOF });
  assert.equal(row.past_due_cents, null);
});

// ---------------------------------------------------------------------------
// Dates — the ordering key and the reported ones are different things.
// ---------------------------------------------------------------------------

test("readDate normalizes to a calendar day and refuses what it cannot parse", () => {
  assert.equal(readDate("2026-06-30"), "2026-06-30");
  assert.equal(readDate("2026-06-30T14:22:00.000Z"), "2026-06-30");
  assert.equal(readDate("06/30/2026"), "2026-06-30");
  assert.equal(readDate("6/3/2026"), "2026-06-03");
  assert.equal(readDate(new Date("2026-06-30T00:00:00Z")), "2026-06-30");
  assert.equal(readDate("02/31/2026"), null, "a day that does not exist is not a date");
  assert.equal(readDate("next tuesday"), null);
  assert.equal(readDate(""), null);
  assert.equal(readDate(null), null);
});

test("as_of is our observation date and is separate from the reported statement date", () => {
  const row = normalizeLiability(
    { balance: 100, statement_date: "06/15/2026", due_date: "07/10/2026" },
    { asOf: "2026-06-30" }
  );
  assert.equal(row.as_of, "2026-06-30", "when we looked");
  assert.equal(row.statement_date, "2026-06-15", "when the bureau says the statement closed");
  assert.equal(row.payment_due_date, "2026-07-10");
});

test("an undateable observation is refused — it cannot be placed in the series", () => {
  assert.equal(normalizeLiability({ balance: 100 }, { asOf: null }), null);
  assert.equal(normalizeLiability({ balance: 100 }, { asOf: "whenever" }), null);
});

// ---------------------------------------------------------------------------
// Payment status — unknown is unknown, and never "current".
// ---------------------------------------------------------------------------

test("readPaymentStatus maps only what it recognises", () => {
  assert.equal(readPaymentStatus("Current"), "current");
  assert.equal(readPaymentStatus("Pays as agreed"), "current");
  assert.equal(readPaymentStatus("30 days late"), "late_30");
  assert.equal(readPaymentStatus("60"), "late_60");
  assert.equal(readPaymentStatus("90+ days"), "late_90");
  assert.equal(readPaymentStatus("120 days past due"), "late_120");
  assert.equal(readPaymentStatus("Charge-Off"), "charge_off");
  assert.equal(readPaymentStatus("Placed for collection"), "collection");
});

test("an unrecognised payment status is NULL, never assumed to be 'current'", () => {
  assert.equal(readPaymentStatus("R9"), null);
  assert.equal(readPaymentStatus("unknown"), null);
  assert.equal(readPaymentStatus(""), null);
  assert.equal(readPaymentStatus(null), null);
  // The expensive direction to be wrong in: calling a delinquent account good.
  assert.notEqual(readPaymentStatus("R9"), "current");
});

test("every mapped status is one the 083/084 CHECK constraint allows", () => {
  const ALLOWED = new Set([
    "current", "late_30", "late_60", "late_90", "late_120", "charge_off", "collection"
  ]);
  for (const s of ["Current", "30", "60", "90", "120", "charge off", "collections", "gibberish"]) {
    const v = readPaymentStatus(s);
    assert.ok(v === null || ALLOWED.has(v), `${s} → ${v} must be null or an allowed value`);
  }
});

// ---------------------------------------------------------------------------
// Record-level behaviour.
// ---------------------------------------------------------------------------

test("a record with no liability measure at all is refused", () => {
  // A lender and a limit is a TRADELINE, not a position. Storing it here would
  // render as a card with no balance and no minimum, which reads as a paid-off
  // card rather than as missing data.
  assert.equal(normalizeLiability({ creditor: "Amex", credit_limit: 18000 }, { asOf: ASOF }), null);
  assert.equal(normalizeLiability(null, { asOf: ASOF }), null);
  assert.equal(normalizeLiability("nope", { asOf: ASOF }), null);
});

test("the raw record is kept verbatim so a disputed reading can be settled", () => {
  const record = { balance: 100, apr: 18.99, vendor_junk: { a: 1 } };
  const row = normalizeLiability(record, { asOf: ASOF });
  assert.deepEqual(row.raw, record);
});

test("source defaults to crs and carries the pull it came from", () => {
  const row = normalizeLiability({ balance: 100 }, { asOf: ASOF, sourceRef: "abc" });
  assert.equal(row.source, "crs");
  assert.equal(row.source_ref, "abc");
  const manual = normalizeLiability({ balance: 100 }, { asOf: ASOF, source: "manual" });
  assert.equal(manual.source, "manual");
});

test("accountRefOf finds the identifier under each name a bureau file uses", () => {
  assert.equal(accountRefOf({ account_number: "A1" }), "A1");
  assert.equal(accountRefOf({ accountNumber: 42 }), "42", "coerced to text for the text column");
  assert.equal(accountRefOf({ nothing: true }), null);
});

// ---------------------------------------------------------------------------
// Whole-payload behaviour.
// ---------------------------------------------------------------------------

test("normalizeLiabilitiesFromCrs dates every position by when the pull was read", () => {
  const rows = normalizeLiabilitiesFromCrs({
    id: "pull-1",
    created_at: "2026-06-30T09:00:00.000Z",
    result: {
      tradelines: [
        { account_number: "A1", balance: 4000, minimum_payment: 120, apr: 14.99 },
        { account_number: "B2", statement_balance: 4700, due_date: "07/12/2026" }
      ]
    }
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.as_of === "2026-06-30"));
  assert.ok(rows.every((r) => r.source === "crs" && r.source_ref === "pull-1"));
  assert.equal(rows[0].apr, 0.1499, "APR converted once, at the edge");
  assert.equal(rows[1].minimum_payment_cents, null, "a card with no reported minimum stays unknown");
});

test("a position with no account_ref is dropped rather than guessed onto a card", () => {
  const rows = normalizeLiabilitiesFromCrs({
    id: "pull-2",
    created_at: "2026-06-30T09:00:00.000Z",
    result: { tradelines: [{ creditor: "Amex", balance: 4000, minimum_payment: 100 }] }
  });
  assert.deepEqual(rows, [],
    "matching on lender name would merge two Amex cards into one");
});

test("an empty or unrecognised payload yields nothing, not a zeroed position", () => {
  assert.deepEqual(normalizeLiabilitiesFromCrs({ result: {} }), []);
  assert.deepEqual(normalizeLiabilitiesFromCrs(null), []);
  assert.deepEqual(normalizeLiabilitiesFromCrs({ result: { tradelines: [] } }), []);
});

test("the envelope forms the tradeline normalizer handles are handled here too", () => {
  const rows = normalizeLiabilitiesFromCrs({
    id: "pull-3",
    created_at: "2026-06-30T09:00:00.000Z",
    result: { report: { accounts: [{ account_id: "C3", balance: 900, minimum_payment: 25 }] } }
  });
  assert.equal(rows.length, 1, "one container list, shared with tradelines");
  assert.equal(rows[0].account_ref, "C3");
});
