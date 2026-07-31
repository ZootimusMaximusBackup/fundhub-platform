// Pure unit tests for the card-liability derived figures.
//
// NO DATABASE, so these run in every pass of `npm test`, including the ones
// with DATABASE_URL unset. That matters here more than usual: the whole point
// of this module is what it does with MISSING data, and a suite that only
// exercises it against a seeded database mostly exercises the present case.
//
// The bulk of this file is about one thing — that an unknown input produces a
// null output and never a 0. AUDIT-FINDINGS.md's fifth lesson is "mutation-test
// the OVER-broad direction too", and the over-broad direction here is a
// utilisation figure that looks fine. A card with an unknown limit reported as
// 0% utilised reads as the healthiest card on the file.

import { test } from "node:test";
import assert from "node:assert";

import {
  asCents,
  asRate,
  utilisation,
  availableCreditCents,
  readIsBusiness,
  readLast4,
  readDate,
  coerceLiabilityRow,
  summarise,
  mergeCardView,
  TERM_FIELDS,
  BANK_REPORTED_FIELDS
} from "./index.mjs";

/* ------------------------------------------------------------------ asCents */

test("asCents reads the strings node-postgres returns for bigint", () => {
  assert.equal(asCents("1800000"), 1800000);
  assert.equal(asCents(1800000), 1800000);
  assert.equal(asCents("  1800000  "), 1800000);
  assert.equal(asCents(0), 0);
  assert.equal(asCents("0"), 0);
  assert.equal(asCents(-500), -500, "reading a negative is not this function's job to refuse");
});

test("asCents keeps absence as absence", () => {
  assert.equal(asCents(null), null);
  assert.equal(asCents(undefined), null);
  assert.equal(asCents(""), null);
});

test("asCents refuses a value that is present and not a whole number of cents", () => {
  assert.throws(() => asCents("abc"), TypeError);
  assert.throws(() => asCents({}), TypeError);
  assert.throws(() => asCents(NaN), TypeError);
  assert.throws(() => asCents(Infinity), TypeError);
  assert.throws(() => asCents(12.5), /whole number/);
  assert.throws(() => asCents("12.5"), /whole number/);
});

test("asCents compares numerically, not lexically — the bug a bare string would hide", () => {
  // "1000000" < "9" as strings. If asCents returned the string, every
  // comparison above a million would silently invert.
  assert.ok(asCents("1000000") > asCents("9"));
});

/* ------------------------------------------------------------------- asRate */

test("asRate reads the strings node-postgres returns for numeric", () => {
  assert.equal(asRate("0.18990"), 0.1899);
  assert.equal(asRate(0.1899), 0.1899);
  assert.equal(asRate("0"), 0);
  assert.equal(asRate(null), null);
  assert.equal(asRate(undefined), null);
  assert.equal(asRate(""), null);
  assert.throws(() => asRate("nope"), TypeError);
});

/* -------------------------------------------------------------- utilisation */

test("utilisation with a null limit is null, NOT 0", () => {
  assert.strictEqual(utilisation(500000, null), null);
  assert.strictEqual(utilisation(500000, undefined), null);
  assert.strictEqual(utilisation(500000, ""), null);
  // The assertion that actually matters: not merely falsy, not zero.
  assert.notStrictEqual(utilisation(500000, null), 0);
});

test("utilisation with a null balance is null, NOT 0", () => {
  assert.strictEqual(utilisation(null, 1000000), null);
  assert.strictEqual(utilisation(undefined, 1000000), null);
  assert.notStrictEqual(utilisation(null, 1000000), 0);
});

test("utilisation with both unknown is null", () => {
  assert.strictEqual(utilisation(null, null), null);
});

test("utilisation with a zero limit is null — no denominator, not 0% and not Infinity", () => {
  assert.strictEqual(utilisation(0, 0), null);
  assert.strictEqual(utilisation(500000, 0), null);
  assert.strictEqual(utilisation(500000, "0"), null);
});

test("a genuinely zero balance on a known limit IS 0 — the fact null must stay distinguishable from", () => {
  assert.strictEqual(utilisation(0, 1000000), 0);
  assert.strictEqual(utilisation("0", "1000000"), 0);
});

test("utilisation computes the fraction, not the percentage", () => {
  assert.equal(utilisation(320000, 1000000), 0.32);
  assert.equal(utilisation(1, 4), 0.25);
  assert.equal(utilisation("820000", "1800000"), 0.45556);
});

test("utilisation over the limit is reported, not clamped", () => {
  assert.equal(utilisation(1200000, 1000000), 1.2);
  assert.ok(utilisation(1200000, 1000000) > 1, "an over-limit card must not read as maxed-but-fine");
});

test("utilisation rounds to 5 decimal places, deterministically", () => {
  assert.equal(utilisation(1, 3), 0.33333);
  assert.equal(utilisation(2, 3), 0.66667);
});

test("utilisation refuses negative cents rather than laundering them into a figure", () => {
  assert.throws(() => utilisation(-1, 1000), RangeError);
  assert.throws(() => utilisation(1000, -1), RangeError);
});

/* ------------------------------------------------------- availableCredit */

test("available credit with an unknown limit is null, NOT 0", () => {
  assert.strictEqual(availableCreditCents(null, 500000), null);
  assert.notStrictEqual(availableCreditCents(null, 500000), 0);
});

test("available credit with an unknown balance is null, NOT 0", () => {
  assert.strictEqual(availableCreditCents(1000000, null), null);
  assert.notStrictEqual(availableCreditCents(1000000, null), 0);
});

test("available credit is the headroom, floored at zero", () => {
  assert.equal(availableCreditCents(1000000, 320000), 680000);
  assert.equal(availableCreditCents(1000000, 0), 1000000);
  assert.equal(availableCreditCents(1000000, 1000000), 0);
  assert.equal(availableCreditCents(1000000, 1200000), 0, "over-limit has no headroom, not negative headroom");
  assert.equal(availableCreditCents("1000000", "320000"), 680000);
});

/* ------------------------------------------------------------ readIsBusiness */

test("readIsBusiness keeps unknown as a third state and never guesses personal", () => {
  for (const v of [null, undefined, "", "   ", "unknown", "n/a", "maybe", {}, [], 7, -1, NaN]) {
    assert.strictEqual(readIsBusiness(v), null, `${JSON.stringify(v)} must be unknown, not personal`);
  }
});

test("readIsBusiness recognises business", () => {
  for (const v of [true, 1, "1", "true", "TRUE", " t ", "yes", "y", "business", "Biz", "commercial", "corporate"]) {
    assert.strictEqual(readIsBusiness(v), true, `${JSON.stringify(v)} should read as business`);
  }
});

test("readIsBusiness recognises personal", () => {
  for (const v of [false, 0, "0", "false", "F", "no", "n", "personal", "Consumer", "individual", "household"]) {
    assert.strictEqual(readIsBusiness(v), false, `${JSON.stringify(v)} should read as personal`);
  }
});

/* ----------------------------------------------------------------- readLast4 */

test("readLast4 accepts four digits however they are masked", () => {
  assert.equal(readLast4("1234"), "1234");
  assert.equal(readLast4(1234), "1234");
  assert.equal(readLast4("****1234"), "1234");
  assert.equal(readLast4("xxxx-1234"), "1234");
  assert.equal(readLast4("•••• 1234"), "1234");
  assert.equal(readLast4("0042"), "0042", "a leading zero is part of the card ending");
});

test("readLast4 refuses a full card number rather than truncating it", () => {
  assert.strictEqual(readLast4("4111111111111234"), null);
  assert.strictEqual(readLast4("4111 1111 1111 1234"), null);
  assert.strictEqual(readLast4("371449635398431"), null);
});

test("readLast4 refuses fewer than four digits rather than padding", () => {
  assert.strictEqual(readLast4("42"), null);
  assert.strictEqual(readLast4(42), null);
  assert.strictEqual(readLast4("1"), null);
});

test("readLast4 keeps absence as absence", () => {
  assert.strictEqual(readLast4(null), null);
  assert.strictEqual(readLast4(undefined), null);
  assert.strictEqual(readLast4(""), null);
  assert.strictEqual(readLast4("no digits here"), null);
});

/* ------------------------------------------------------------------ readDate */

test("readDate keeps a missing due date missing — never today, never end of month", () => {
  for (const v of [null, undefined, "", "   ", "soon", "next month", "15/08/2026", 20260815]) {
    assert.strictEqual(readDate(v), null, `${JSON.stringify(v)} must not become a date`);
  }
});

test("readDate reads a calendar day", () => {
  assert.equal(readDate("2026-08-15"), "2026-08-15");
  assert.equal(readDate("2026-08-15T00:00:00Z"), "2026-08-15");
  assert.equal(readDate("2026-08-15T23:59:59.999Z"), "2026-08-15");
  assert.equal(readDate(new Date(Date.UTC(2026, 7, 15))), "2026-08-15");
});

test("readDate refuses a day that does not exist rather than rolling it forward", () => {
  assert.strictEqual(readDate("2026-02-31"), null);
  assert.strictEqual(readDate("2026-13-01"), null);
  assert.strictEqual(readDate("2026-00-10"), null);
  assert.strictEqual(readDate("2025-02-29"), null, "2025 is not a leap year");
  assert.equal(readDate("2024-02-29"), "2024-02-29", "2024 is");
});

test("readDate refuses an invalid Date instance", () => {
  assert.strictEqual(readDate(new Date("nonsense")), null);
});

/* -------------------------------------------------------- coerceLiabilityRow */

test("coerceLiabilityRow converts dollars to cents and leaves absent money absent", () => {
  const row = coerceLiabilityRow({
    accountRef: "acct-1",
    issuer: "Chase Ink Business Preferred",
    creditLimit: 25000,
    balance: 4137.42
    // statementBalance and minimumPayment deliberately omitted
  });
  assert.equal(row.credit_limit_cents, 2500000);
  assert.equal(row.balance_cents, 413742);
  assert.strictEqual(row.statement_balance_cents, null, "omitted money is unknown, not zero");
  assert.strictEqual(row.minimum_payment_cents, null);
});

test("coerceLiabilityRow does NOT inherit money.mjs's toCents(null) -> 0", () => {
  // The whole reason this module imports toCents from ../tradelines and not
  // from ../commissions/money.mjs. A $0 limit is 100% utilisation on any
  // balance; an unknown limit is no utilisation at all.
  const row = coerceLiabilityRow({ accountRef: "a", issuer: "X", creditLimit: null });
  assert.strictEqual(row.credit_limit_cents, null);
  assert.notStrictEqual(row.credit_limit_cents, 0);
});

test("coerceLiabilityRow reads APRs as fractions whether given percent or fraction", () => {
  const row = coerceLiabilityRow({
    accountRef: "a", issuer: "X",
    aprPurchase: 18.99, aprCashAdvance: 0.2999, aprBalanceTransfer: "0%"
  });
  assert.equal(row.apr_purchase, 0.1899);
  assert.equal(row.apr_cash_advance, 0.2999);
  assert.equal(row.apr_balance_transfer, 0);
});

test("coerceLiabilityRow leaves an unreported APR null rather than zero", () => {
  const row = coerceLiabilityRow({ accountRef: "a", issuer: "X" });
  assert.strictEqual(row.apr_purchase, null);
  assert.strictEqual(row.apr_cash_advance, null);
  assert.strictEqual(row.apr_balance_transfer, null);
});

test("coerceLiabilityRow leaves an unclassified card unclassified", () => {
  const row = coerceLiabilityRow({ accountRef: "a", issuer: "X" });
  assert.strictEqual(row.is_business, null);
  assert.strictEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X", isBusiness: "business" }).is_business, true);
  assert.strictEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X", isBusiness: false }).is_business, false);
});

test("coerceLiabilityRow reports a blank account reference as absent so the store can refuse it", () => {
  assert.strictEqual(coerceLiabilityRow({ issuer: "X" }).account_ref, null);
  assert.strictEqual(coerceLiabilityRow({ accountRef: "   ", issuer: "X" }).account_ref, null);
  assert.equal(coerceLiabilityRow({ accountRef: " acct-1 ", issuer: "X" }).account_ref, "acct-1");
});

test("coerceLiabilityRow never lets a full card number through as last4", () => {
  assert.strictEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X", last4: "4111111111111234" }).last4, null);
});

test("coerceLiabilityRow keeps the unparsed record and defaults it to an object", () => {
  assert.deepEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X" }).raw, {});
  assert.deepEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X", raw: { z: 1 } }).raw, { z: 1 });
  assert.deepEqual(coerceLiabilityRow({ accountRef: "a", issuer: "X", raw: "not an object" }).raw, {});
});

/* ---------------------------------------------------------------- summarise */

const card = (over = {}) => ({
  credit_limit_cents: 1000000, balance_cents: 250000, is_business: null, closed_at: null, ...over
});

test("summarise on nothing is all zeroes and a null utilisation", () => {
  const s = summarise([]);
  assert.equal(s.all.count, 0);
  assert.equal(s.all.limitCents, 0);
  assert.strictEqual(s.all.utilisation, null, "no cards is not 0% utilised");
});

test("summarise splits business, personal and unclassified and never folds unknown into either side", () => {
  const s = summarise([
    card({ is_business: true, credit_limit_cents: 2000000, balance_cents: 400000 }),
    card({ is_business: false, credit_limit_cents: 1000000, balance_cents: 100000 }),
    card({ is_business: null, credit_limit_cents: 500000, balance_cents: 50000 })
  ]);
  assert.equal(s.business.count, 1);
  assert.equal(s.personal.count, 1);
  assert.equal(s.unclassified.count, 1);
  assert.equal(s.all.count, 3);
  assert.equal(s.business.limitCents, 2000000);
  assert.equal(s.personal.limitCents, 1000000);
  assert.equal(s.unclassified.limitCents, 500000);
  assert.equal(s.all.limitCents, 3500000);
});

test("summarise reports the known sum AND how many rows were not known", () => {
  const s = summarise([
    card({ credit_limit_cents: 1000000, balance_cents: 250000 }),
    card({ credit_limit_cents: null, balance_cents: 400000 })
  ]);
  assert.equal(s.all.limitCents, 1000000, "the known part is reported");
  assert.equal(s.all.limitUnknownCount, 1, "and the unknown part is counted, not hidden");
  assert.equal(s.all.balanceCents, 650000);
  assert.equal(s.all.balanceUnknownCount, 0);
});

test("summarise refuses a blended utilisation when any contributing row is unknown", () => {
  const s = summarise([
    card({ credit_limit_cents: 1000000, balance_cents: 250000 }),
    card({ credit_limit_cents: null, balance_cents: 900000 })
  ]);
  // 250000/1000000 = 25% would read as a healthy file. The truth is that we do
  // not know what this client's utilisation is.
  assert.strictEqual(s.all.utilisation, null);
  assert.notStrictEqual(s.all.utilisation, 0.25);
});

test("summarise computes utilisation when every contributing row is known", () => {
  const s = summarise([
    card({ credit_limit_cents: 1000000, balance_cents: 250000 }),
    card({ credit_limit_cents: 1000000, balance_cents: 750000 })
  ]);
  assert.equal(s.all.utilisation, 0.5);
});

test("summarise's per-bucket utilisation is independent — one unknown business card does not null the personal figure", () => {
  const s = summarise([
    card({ is_business: true, credit_limit_cents: null, balance_cents: 100000 }),
    card({ is_business: false, credit_limit_cents: 1000000, balance_cents: 300000 })
  ]);
  assert.strictEqual(s.business.utilisation, null);
  assert.equal(s.personal.utilisation, 0.3);
  assert.strictEqual(s.all.utilisation, null, "the total is still unknown, because part of it is");
});

test("summarise skips closed cards", () => {
  const s = summarise([
    card({ credit_limit_cents: 1000000, balance_cents: 250000 }),
    card({ credit_limit_cents: 9900000, balance_cents: 0, closed_at: "2026-01-01T00:00:00Z" })
  ]);
  assert.equal(s.all.count, 1);
  assert.equal(s.all.limitCents, 1000000, "a closed card's limit is not headroom");
  assert.equal(s.all.utilisation, 0.25);
});

test("summarise tolerates null rows and pg's string bigints", () => {
  const s = summarise([null, undefined, card({ credit_limit_cents: "1000000", balance_cents: "250000" })]);
  assert.equal(s.all.count, 1);
  assert.equal(s.all.limitCents, 1000000);
  assert.equal(s.all.utilisation, 0.25);
});

test("summarise counts available credit as unknown when either side of it is", () => {
  const s = summarise([card({ credit_limit_cents: null })]);
  assert.equal(s.all.availableCents, 0, "nothing known to add");
  assert.equal(s.all.availableUnknownCount, 1, "and the row is counted as unknown, not as zero headroom");
});

/* ------------------------------------------------------------ mergeCardView */

const bureauRow = (over = {}) => ({
  id: "t-1", client_id: "c-1", source: "crs", lender: "AMEX", kind: "revolving",
  credit_limit_cents: "1800000", balance_cents: "820000", apr: "0.16990", closed_at: null, as_of: null, ...over
});

const bankRow = (over = {}) => ({
  id: "l-1", client_id: "c-1", tradeline_id: "t-1", issuer: "American Express Blue Business Cash",
  last4: "1004", is_business: true,
  credit_limit_cents: "2000000", balance_cents: "700000",
  statement_balance_cents: "690000", minimum_payment_cents: "3500",
  apr_purchase: "0.17990", apr_cash_advance: "0.29990", apr_balance_transfer: null,
  statement_close_date: "2026-07-20", payment_due_date: "2026-08-15",
  closed_at: null, as_of: null, ...over
});

test("mergeCardView returns null only when there is nothing to merge", () => {
  assert.strictEqual(mergeCardView(null, null), null);
  assert.ok(mergeCardView(bureauRow(), null));
  assert.ok(mergeCardView(null, bankRow()));
});

test("the bank wins every field the bank actually reported", () => {
  const m = mergeCardView(bureauRow(), bankRow());
  assert.equal(m.issuer, "American Express Blue Business Cash");
  assert.equal(m.creditLimitCents, 2000000);
  assert.equal(m.balanceCents, 700000);
  assert.equal(m.aprPurchase, 0.1799);
  assert.equal(m.provenance.issuer, "bank");
  assert.equal(m.provenance.creditLimitCents, "bank");
  assert.equal(m.provenance.aprPurchase, "bank");
});

test("a NULL from the bank is not a correction and never overwrites what the bureau knew", () => {
  const m = mergeCardView(
    bureauRow({ credit_limit_cents: "1800000", apr: "0.16990" }),
    bankRow({ credit_limit_cents: null, apr_purchase: null })
  );
  assert.equal(m.creditLimitCents, 1800000, "the bureau's limit survives");
  assert.equal(m.aprPurchase, 0.1699, "the bureau's rate survives");
  assert.equal(m.provenance.creditLimitCents, "crs");
  assert.equal(m.provenance.aprPurchase, "crs");
});

test("a field neither source knows is null with no provenance", () => {
  const m = mergeCardView(bureauRow(), bankRow({ apr_balance_transfer: null }));
  assert.strictEqual(m.aprBalanceTransfer, null);
  assert.strictEqual(m.provenance.aprBalanceTransfer, null);
});

test("bank-only fields come only from the bank, and are null when there is no bank row", () => {
  const bureauOnly = mergeCardView(bureauRow(), null);
  for (const k of ["statementBalanceCents", "minimumPaymentCents", "statementCloseDate", "paymentDueDate", "last4", "isBusiness"]) {
    assert.strictEqual(bureauOnly[k], null, `${k} is not something a bureau file carries`);
    assert.strictEqual(bureauOnly.provenance[k], null);
  }
  const withBank = mergeCardView(bureauRow(), bankRow());
  assert.equal(withBank.statementBalanceCents, 690000);
  assert.equal(withBank.minimumPaymentCents, 3500);
  assert.equal(withBank.paymentDueDate, "2026-08-15");
  assert.equal(withBank.last4, "1004");
  assert.strictEqual(withBank.isBusiness, true);
  assert.equal(withBank.provenance.paymentDueDate, "bank");
});

test("bureau-only fields come only from the bureau", () => {
  const m = mergeCardView(bureauRow({ kind: "loc" }), bankRow());
  assert.equal(m.kind, "loc");
  assert.equal(m.provenance.kind, "crs");
  assert.strictEqual(mergeCardView(null, bankRow()).kind, null);
});

test("provenance distinguishes a manually typed bureau line from a soft pull", () => {
  const m = mergeCardView(bureauRow({ source: "manual" }), bankRow({ credit_limit_cents: null }));
  assert.equal(m.provenance.creditLimitCents, "manual");
});

test("merged utilisation uses the merged numbers, and is null when the merged limit is unknown", () => {
  const known = mergeCardView(bureauRow(), bankRow());
  assert.equal(known.creditLimitCents, 2000000);
  assert.equal(known.balanceCents, 700000);
  assert.equal(known.utilisation, 0.35);
  assert.equal(known.availableCents, 1300000);

  const unknownLimit = mergeCardView(
    bureauRow({ credit_limit_cents: null }),
    bankRow({ credit_limit_cents: null })
  );
  assert.strictEqual(unknownLimit.utilisation, null);
  assert.notStrictEqual(unknownLimit.utilisation, 0);
  assert.strictEqual(unknownLimit.availableCents, null);
});

test("a bank-only card carries the link it already has back to a tradeline", () => {
  const m = mergeCardView(null, bankRow({ tradeline_id: "t-9" }));
  assert.equal(m.tradelineId, "t-9");
  assert.equal(m.cardLiabilityId, "l-1");
  assert.equal(m.clientId, "c-1");
});

test("a bureau-only card reports no card-liability id", () => {
  const m = mergeCardView(bureauRow(), null);
  assert.strictEqual(m.cardLiabilityId, null);
  assert.equal(m.tradelineId, "t-1");
});

test("merging a false is_business does not fall through to the bureau", () => {
  // The over-broad direction: `bankValue || bureauValue` would treat false as
  // absent and a business card wrongly classified as personal would silently
  // become unclassified.
  const m = mergeCardView(bureauRow(), bankRow({ is_business: false }));
  assert.strictEqual(m.isBusiness, false);
  assert.equal(m.provenance.isBusiness, "bank");
});

test("merging a zero balance does not fall through to the bureau", () => {
  const m = mergeCardView(bureauRow({ balance_cents: "820000" }), bankRow({ balance_cents: 0 }));
  assert.strictEqual(m.balanceCents, 0, "a paid-off card is not a card we have no balance for");
  assert.equal(m.provenance.balanceCents, "bank");
  assert.equal(m.utilisation, 0);
});

test("merging a 0% APR does not fall through to the bureau", () => {
  const m = mergeCardView(bureauRow({ apr: "0.16990" }), bankRow({ apr_purchase: 0 }));
  assert.strictEqual(m.aprPurchase, 0);
  assert.equal(m.provenance.aprPurchase, "bank");
});

/* --------------------------------------------------------- the field lists */

test("TERM_FIELDS names exactly what 084 versions", () => {
  assert.deepEqual(TERM_FIELDS, [
    "credit_limit_cents", "apr_purchase", "apr_cash_advance", "apr_balance_transfer", "is_business"
  ]);
  for (const f of ["balance_cents", "statement_balance_cents", "minimum_payment_cents", "payment_due_date"]) {
    assert.ok(!TERM_FIELDS.includes(f), `${f} is a reading, not a term — versioning it is a different table`);
  }
});

test("BANK_REPORTED_FIELDS names only things a bureau file does not carry", () => {
  for (const f of BANK_REPORTED_FIELDS) {
    assert.ok(!["lender", "kind", "apr", "credit_limit_cents", "balance_cents"].includes(f),
      `${f} is on the bureau file too`);
  }
});
