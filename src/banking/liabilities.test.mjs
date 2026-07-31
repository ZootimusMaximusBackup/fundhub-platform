// Unit tests for card liability normalization and reads. No database.
//
// Every test here is a refusal. The output of this module feeds a screen that
// tells a person when to move their money, so the failures worth guarding
// against are all of the form "a plausible value was accepted when nothing was
// known":
//
//   a missing due date becoming today       -> pay on the wrong day
//   a missing minimum payment becoming 0    -> skip a payment
//   an unknown is_overdue becoming false    -> unearned reassurance
//   "2026" parsing as 1 January 2026        -> a real-looking date from nonsense
//   the first APR in the list as the rate   -> quote the cash-advance rate

import { test } from "node:test";
import assert from "node:assert";
import {
  toCents, readDate, readBool, normalizeLiability,
  getCurrentLiability, listCurrentLiabilities, getLiabilityHistory, LiabilityError
} from "./liabilities.mjs";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function stubDb({ rows = [] } = {}) {
  const calls = [];
  return {
    calls,
    query(sql, params = []) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return { rows };
    }
  };
}

/* -------------------------------- readDate -------------------------------- */

test("readDate accepts a real ISO date", () => {
  assert.equal(readDate("2026-08-15"), "2026-08-15");
  assert.equal(readDate("2026-08-15T00:00:00Z"), "2026-08-15");
  assert.equal(readDate(new Date(Date.UTC(2026, 7, 15))), "2026-08-15");
});

test("READDATE REFUSES THE NONSENSE new Date() WOULD HAPPILY ACCEPT", () => {
  // new Date("2026") is 1 Jan 2026; new Date("07/31") is a date in 2001.
  assert.equal(readDate("2026"), null);
  assert.equal(readDate("07/31"), null);
  assert.equal(readDate("08/15/2026"), null);
  assert.equal(readDate("next tuesday"), null);
  assert.equal(readDate("the 15th"), null);
  assert.equal(readDate(1755216000000), null, "an epoch number is not a due date");
});

test("readDate refuses a day that does not exist", () => {
  assert.equal(readDate("2026-02-30"), null, "a rolled-over date is a wrong date, not a near miss");
  assert.equal(readDate("2026-13-01"), null);
  assert.equal(readDate("2025-02-29"), null);
  assert.equal(readDate("2024-02-29"), "2024-02-29", "a real leap day is real");
});

test("readDate returns null for nothing, never today", () => {
  assert.equal(readDate(null), null);
  assert.equal(readDate(""), null);
  assert.equal(readDate(undefined), null);
  assert.equal(readDate(new Date("nonsense")), null);
});

/* --------------------------------- toCents -------------------------------- */

test("toCents reads the string forms a payload actually uses", () => {
  assert.equal(toCents(150.25), 15025);
  assert.equal(toCents("1,500.50"), 150050);
  assert.equal(toCents("$2,000"), 200000);
});

test("A MISSING AMOUNT IS NULL, NOT ZERO", () => {
  assert.equal(toCents(null), null);
  assert.equal(toCents(""), null);
  assert.equal(toCents("n/a"), null);
  assert.equal(toCents(undefined), null,
    "a minimum payment of 0 means 'you owe nothing'; unknown means we do not know what you owe");
});

test("a negative amount is real on a card and is kept", () => {
  assert.equal(toCents(-250), -25000, "a card can carry a credit balance");
});

/* -------------------------------- readBool -------------------------------- */

test("is_overdue is three-state — false and unknown are different answers", () => {
  assert.equal(readBool(true), true);
  assert.equal(readBool(false), false);
  assert.equal(readBool(null), null);
  assert.equal(readBool(undefined), null);
  assert.equal(readBool(0), null, "0 is not false here — it is unrecognised");
  assert.equal(readBool("no"), null);
});

/* --------------------------- normalizeLiability --------------------------- */

test("a full payload normalizes to cents, dates and a fraction APR", () => {
  const out = normalizeLiability({
    last_statement_balance: 1250.5,
    last_statement_issue_date: "2026-07-01",
    minimum_payment_amount: 35,
    next_payment_due_date: "2026-07-28",
    last_payment_amount: 100,
    last_payment_date: "2026-06-27",
    is_overdue: false,
    aprs: [
      { apr_type: "purchase_apr", apr_percentage: 18.99, balance_subject_to_apr: 1250.5 },
      { apr_type: "cash_apr", apr_percentage: 29.99 }
    ]
  }, { asOf: "2026-07-20T10:00:00Z" });

  assert.equal(out.lastStatementBalanceCents, 125050);
  assert.equal(out.minimumPaymentCents, 3500);
  assert.equal(out.nextPaymentDueDate, "2026-07-28");
  assert.equal(out.isOverdue, false);
  assert.equal(out.apr, 0.1899, "APR is a fraction in [0,1], not a percentage number");
  assert.equal(out.asOf, "2026-07-20T10:00:00Z");
});

test("THE HEADLINE APR IS THE PURCHASE RATE, NEVER JUST THE FIRST IN THE LIST", () => {
  const out = normalizeLiability({
    aprs: [
      { apr_type: "cash_apr", apr_percentage: 29.99 },
      { apr_type: "purchase_apr", apr_percentage: 18.99 }
    ]
  });
  assert.equal(out.apr, 0.1899,
    "the cash-advance rate is the highest number on the card and is not what a card being used normally costs");
});

test("with no purchase APR named, the headline is null rather than a guess", () => {
  const out = normalizeLiability({ aprs: [{ apr_type: "cash_apr", apr_percentage: 29.99 }] });
  assert.equal(out.apr, null);
  assert.equal(out.aprs.length, 1, "the breakdown is still kept — it just does not become the headline");
});

test("an APR entry whose rate cannot be read is dropped, not kept with a null rate", () => {
  const out = normalizeLiability({
    aprs: [{ apr_type: "purchase_apr", apr_percentage: "variable" }, { apr_type: "cash_apr", apr_percentage: 24.99 }]
  });
  assert.equal(out.aprs.length, 1);
  assert.equal(out.aprs[0].type, "cash_apr");
  assert.equal(out.apr, null, "a breakdown row that cannot say its own rate is not a breakdown of anything");
});

test("an impossible APR is refused rather than clamped", () => {
  assert.equal(normalizeLiability({ apr: 150 }).apr, null);
  assert.equal(normalizeLiability({ apr: -4 }).apr, null);
});

test("AN EMPTY PAYLOAD PRODUCES ALL NULLS AND NOT A SINGLE ZERO OR DATE", () => {
  const out = normalizeLiability({});
  assert.equal(out.nextPaymentDueDate, null);
  assert.equal(out.minimumPaymentCents, null);
  assert.equal(out.lastStatementBalanceCents, null);
  assert.equal(out.isOverdue, null);
  assert.equal(out.apr, null);
  assert.deepEqual(out.aprs, []);
  assert.equal(out.asOf, null);
});

test("a due date that cannot be parsed does not fall back to another field", () => {
  const out = normalizeLiability({
    next_payment_due_date: "end of month",
    last_statement_issue_date: "2026-07-01"
  });
  assert.equal(out.nextPaymentDueDate, null,
    "borrowing the statement date would be inventing a due date");
});

test("normalization has no clock — the same payload gives the same output", () => {
  const payload = { minimum_payment_amount: 35, next_payment_due_date: "2026-07-28" };
  assert.deepEqual(normalizeLiability(payload), normalizeLiability(payload));
  assert.equal(normalizeLiability(payload).asOf, null, "asOf is supplied, never invented");
});

test("camelCase and snake_case payloads both read", () => {
  const a = normalizeLiability({ nextPaymentDueDate: "2026-09-01", minimumPaymentAmount: 40 });
  assert.equal(a.nextPaymentDueDate, "2026-09-01");
  assert.equal(a.minimumPaymentCents, 4000);
});

/* ------------------------------- the reads -------------------------------- */

test("getCurrentLiability requires an account", async () => {
  await assert.rejects(() => getCurrentLiability(stubDb(), {}), LiabilityError);
});

test("getCurrentLiability returns null when nothing is on file", async () => {
  assert.equal(await getCurrentLiability(stubDb({ rows: [] }), { bankAccountId: ACCOUNT }), null,
    "no liability record is the normal state for a checking account — it is not 'nothing due'");
});

test("AN UNKNOWN DUE DATE SORTS LAST, NEVER FIRST", async () => {
  const db = stubDb();
  await listCurrentLiabilities(db, { clientId: CLIENT });
  assert.match(db.calls.at(-1).sql, /ORDER BY l\.next_payment_due_date ASC NULLS LAST/,
    "sorted first it would head a 'what is due next' list and read as the most urgent item on the screen");
});

test("the client list only shows open accounts", async () => {
  const db = stubDb();
  await listCurrentLiabilities(db, { clientId: CLIENT });
  assert.match(db.calls.at(-1).sql, /a\.status = 'open'/);
});

test("the client list carries entity kind so a caller can group it", async () => {
  const db = stubDb();
  await listCurrentLiabilities(db, { clientId: CLIENT });
  assert.match(db.calls.at(-1).sql, /a\.entity_kind, a\.entity_kind_source/);
});

test("getLiabilityHistory is newest first and bounded", async () => {
  const db = stubDb();
  await getLiabilityHistory(db, { bankAccountId: ACCOUNT, limit: 999999 });
  assert.match(db.calls.at(-1).sql, /ORDER BY as_of DESC, id DESC/);
  assert.equal(db.calls.at(-1).params[1], 200);

  await getLiabilityHistory(db, { bankAccountId: ACCOUNT, limit: 0 });
  assert.equal(db.calls.at(-1).params[1], 1);

  await getLiabilityHistory(db, { bankAccountId: ACCOUNT, limit: "lots" });
  assert.equal(db.calls.at(-1).params[1], 50);
});

test("the reads require their identifiers", async () => {
  await assert.rejects(() => listCurrentLiabilities(stubDb(), {}), /clientId is required/);
  await assert.rejects(() => getLiabilityHistory(stubDb(), {}), /bankAccountId is required/);
});
