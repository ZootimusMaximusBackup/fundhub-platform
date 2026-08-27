// Unit tests for the tradeline normalizer. No database — this half is pure.
//
// The tests that matter here are the refusals. Everything this module does that
// is worth testing is a case where a plausible-looking value must NOT be
// accepted, because the consumer is a waterfall that draws the cheapest money
// first: a mis-read APR does not produce a slightly wrong report, it produces a
// confidently wrong draw order.

import { test } from "node:test";
import assert from "node:assert";
import {
  toCents, fromCents, readApr, readOpenedOn, readKind,
  extractTradelineRecords, normalizeTradeline, normalizeFromCrs, toCalculatorCards,
  linesForEngine
} from "./index.mjs";

test("toCents handles the string forms a bureau file actually uses", () => {
  assert.equal(toCents(150), 15000);
  assert.equal(toCents("1,500.50"), 150050);
  assert.equal(toCents("$2,000"), 200000);
  assert.equal(toCents(""), null);
  assert.equal(toCents(null), null);
  assert.equal(toCents("n/a"), null);
  assert.equal(toCents(-5), null, "a negative limit is not a limit");
});

test("fromCents round-trips without float drift", () => {
  assert.equal(fromCents(toCents("1,234.56")), 1234.56);
  assert.equal(fromCents(null), null);
});

test("readApr reads both the percentage and the fraction form", () => {
  assert.equal(readApr(18.99), 0.1899, "a number above 1 is a percentage");
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

test("readOpenedOn reads a real calendar date and normalizes to YYYY-MM-DD", () => {
  assert.equal(readOpenedOn("2022-12-13"), "2022-12-13", "the CRS sandbox's own accountOpenedDate shape");
  assert.equal(readOpenedOn("1990-01-01"), "1990-01-01");
  assert.equal(readOpenedOn("2022-12-13T00:00:00.000Z"), "2022-12-13", "a full timestamp still yields the day");
});

test("readOpenedOn refuses rather than guesses what it cannot read", () => {
  assert.equal(readOpenedOn(null), null);
  assert.equal(readOpenedOn(""), null);
  assert.equal(readOpenedOn("unknown"), null);
  assert.equal(readOpenedOn("2022-13-01"), null, "month 13 is not a calendar date");
  assert.equal(readOpenedOn("2022-02-30"), null, "February has no 30th");
});

test("readKind keeps installment lines identifiable", () => {
  assert.equal(readKind("Revolving"), "revolving");
  assert.equal(readKind("credit card"), "revolving");
  assert.equal(readKind("Installment"), "installment");
  assert.equal(readKind("Auto Loan"), "installment");
  assert.equal(readKind("Line of Credit"), "loc");
  assert.equal(readKind("HELOC"), "loc");
  assert.equal(readKind(undefined), "revolving", "unknown defaults to the container's own subject");
});

test("extractTradelineRecords finds the list under each known key, and one level down", () => {
  assert.equal(extractTradelineRecords({ tradelines: [{ a: 1 }] }).length, 1);
  assert.equal(extractTradelineRecords({ trade_lines: [{ a: 1 }, { b: 2 }] }).length, 2);
  assert.equal(extractTradelineRecords({ report: { accounts: [{ a: 1 }] } }).length, 1);
  assert.deepEqual(extractTradelineRecords({ nothing: true }), []);
  assert.deepEqual(extractTradelineRecords(null), []);
});

test("normalizeTradeline maps a full record", () => {
  const row = normalizeTradeline({
    creditor: "Amex Blue Business",
    account_type: "Revolving",
    credit_limit: "18,000",
    balance: 8200,
    apr: 16.99,
    account_number: "XXXX1234"
  }, { source: "crs", sourceRef: "ref-1", asOf: "2026-07-30T00:00:00Z" });

  assert.equal(row.lender, "Amex Blue Business");
  assert.equal(row.kind, "revolving");
  assert.equal(row.credit_limit_cents, 1800000);
  assert.equal(row.balance_cents, 820000);
  assert.equal(row.apr, 0.1699);
  assert.equal(row.source, "crs");
  assert.equal(row.source_ref, "ref-1");
  assert.equal(row.account_ref, "XXXX1234");
  assert.equal(row.as_of, "2026-07-30T00:00:00Z");
  assert.equal(row.raw.creditor, "Amex Blue Business", "the unparsed record is kept verbatim");
});

test("normalizeTradeline maps a real CRS sandbox tradeline, verbatim", () => {
  // Taken unmodified from the vendor's own CRS Sandbox JSON Payload Library
  // (TransUnion response), confirmed 2026-08-01 to be the real, live payload
  // shape — NOT the synthetic shape this file's other fixtures use. Before this
  // fix, every field below except `accountType` fell through every key list:
  // `lender` and `credit_limit_cents` both resolved null, and normalizeTradeline
  // would have dropped this tradeline entirely (see the null-lender-and-null-
  // limit rule below).
  const row = normalizeTradeline({
    accountIdentifier: "111110316779",
    accountOpenedDate: "2020-12-11",
    accountOwnershipType: "AuthorizedUser",
    accountReportedDate: "2025-11-03",
    accountStatusType: "Open",
    accountType: "Revolving",
    borrowerSourceType: "Borrower",
    creditLimitAmount: "8400",
    derogatoryDataIndicator: false,
    highBalanceAmount: "0",
    lastActivityDate: "2025-11-03",
    monthlyPaymentAmount: "20",
    monthsReviewedCount: "26",
    creditorName: "CITI",
    subscriberCode: "B 064DB003",
    pastDueAmount: "0",
    currentBalanceAmount: "608",
    businessType: "Banking",
    loanType: "CreditCard",
    sourceType: "TransUnion"
  }, { source: "crs", sourceRef: "crs-real-1", asOf: "2026-03-01T21:08:27.195Z" });

  assert.ok(row, "a real bureau tradeline must survive the normalizer, not be dropped");
  assert.equal(row.lender, "CITI", "creditorName must be read — it was not on any old key list");
  assert.equal(row.kind, "revolving");
  assert.equal(row.credit_limit_cents, 840000, "creditLimitAmount: \"8400\" -> 840000 cents");
  assert.equal(row.balance_cents, 60800, "currentBalanceAmount: \"608\" -> 60800 cents");
  assert.equal(row.apr, null, "the CRS sandbox carries no APR field on tradelines; must stay unknown, not 0");
  assert.equal(row.account_ref, "111110316779", "accountIdentifier must be read as the account reference");
  assert.equal(row.opened_on, "2020-12-11", "accountOpenedDate must be read and passed through unmodified");
});

test("a missing APR stays null instead of becoming free money", () => {
  const row = normalizeTradeline({ creditor: "Chase", credit_limit: 22000, balance: 8400 });
  assert.equal(row.apr, null);
  assert.equal(row.credit_limit_cents, 2200000);
});

test("a record with neither lender nor limit is not a tradeline", () => {
  assert.equal(normalizeTradeline({ balance: 100 }), null);
  assert.equal(normalizeTradeline(null), null);
  assert.equal(normalizeTradeline("nope"), null);
});

test("normalizeFromCrs carries the pull's id and date onto every line", () => {
  const rows = normalizeFromCrs({
    id: "crs-9",
    org_id: "org-1",
    client_id: "client-1",
    created_at: "2026-07-29T12:00:00Z",
    result: {
      tradelines: [
        { creditor: "Capital One Spark", credit_limit: 15000, balance: 4000, apr: 14.99, account_number: "A1" },
        { creditor: "Citi Costco", credit_limit: 12000, balance: 4700, apr: 18.99, account_number: "A2" },
        { balance: 10 } // not a tradeline — dropped
      ]
    }
  });

  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.source === "crs" && r.source_ref === "crs-9"));
  assert.ok(rows.every((r) => r.as_of === "2026-07-29T12:00:00Z"));
});

test("toCalculatorCards produces exactly what calcFunding takes", () => {
  const cards = toCalculatorCards([
    { id: "1", lender: "Amex", kind: "revolving", credit_limit_cents: 1800000, balance_cents: 820000, apr: "0.16990" },
    { id: "2", lender: "Auto loan", kind: "installment", credit_limit_cents: 3000000, balance_cents: 0, apr: "0.06000" },
    { id: "3", lender: "Closed card", kind: "revolving", credit_limit_cents: 500000, balance_cents: 0, apr: null, closed_at: "2026-01-01" }
  ]);

  assert.equal(cards.length, 1, "installment and closed lines are excluded from allocation");
  assert.deepEqual(cards[0], { id: "1", lender: "Amex", creditLimit: 18000, currentBalance: 8200, apr: 0.1699 });
});

test("a null balance becomes zero, a null limit does not become zero", () => {
  const [card] = toCalculatorCards([
    { id: "1", lender: "X", kind: "revolving", credit_limit_cents: 100000, balance_cents: null, apr: null }
  ]);
  assert.equal(card.currentBalance, 0, "no reported balance means nothing drawn");
  assert.equal(card.creditLimit, 1000);
  assert.equal(card.apr, null, "an unknown rate stays unknown and sorts last");
});

/* linesForEngine — the one rule both money readers share. */

const PULL_WITH_LINES = {
  id: "crs-1",
  created_at: "2026-08-27T00:00:00Z",
  result: {
    scores: { ex: 718, eq: 724, tu: 731 },
    tradelines: [{
      creditorName: "American Express", accountType: "revolving",
      creditLimitAmount: "25000", currentBalance: "4800",
      accountOpenedDate: "2020-08-01"
    }]
  }
};
const PULL_NO_LINES = { id: "crs-0", created_at: "2026-08-28T00:00:00Z", result: { scores: { ex: 718 } } };

test("linesForEngine: stored rows win and the pull is not read on top of them", () => {
  const stored = [{ id: "t1", lender: "Chase", kind: "revolving", credit_limit_cents: 1_000_000 }];
  const out = linesForEngine(stored, [PULL_WITH_LINES]);
  assert.equal(out.source, "tradelines");
  assert.deepEqual(out.tradelines, stored);
});

test("linesForEngine: an empty table falls back to the accounts inside the pull", () => {
  const out = linesForEngine([], [PULL_WITH_LINES]);
  assert.equal(out.source, "crs_results");
  assert.equal(out.tradelines.length, 1);
  assert.equal(out.tradelines[0].credit_limit_cents, 2_500_000);
  assert.equal(out.tradelines[0].opened_on, "2020-08-01");
});

test("linesForEngine: an empty newer pull does not hide the accounts in an older one", () => {
  const out = linesForEngine([], [PULL_NO_LINES, PULL_WITH_LINES]);
  assert.equal(out.source, "crs_results");
  assert.equal(out.tradelines.length, 1);
});

test("linesForEngine: nothing anywhere is reported as nothing, never filled in", () => {
  const out = linesForEngine([], [PULL_NO_LINES]);
  assert.equal(out.source, "none");
  assert.deepEqual(out.tradelines, []);
  assert.deepEqual(linesForEngine().tradelines, []);
  assert.equal(linesForEngine().source, "none");
});
