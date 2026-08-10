// § 5.2 status consistency — M2-011 … M2-017.
//
// These are the findings that need no outside evidence: a tradeline that says
// two incompatible things about itself is wrong on its face. So the negative
// fixtures here are about the OTHER failure mode — firing on a field the report
// format does not carry, which would produce a letter claiming a contradiction
// nobody can see.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkStatusBalanceConsistency,
  checkStatusPastDueConsistency,
  checkStatusPaymentRatingConsistency,
  checkStatusPaymentHistoryConsistency,
  checkProhibitedStatusSequence,
  checkSpecialCommentConsistency,
  checkCollectorProhibitedStatus
} from "./status-consistency.mjs";
import { cleanTradeline, cleanContext, blindTradeline, observed, absent, notVisible } from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.ok(["deletion", "strong", "moderate", "supporting"].includes(v.severity));
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

// ── M2-011 — 17A + 21 ──────────────────────────────────────────────────────

test("M2-011 fires when a paid/zero-balance status carries a balance", () => {
  const [v] = checkStatusBalanceConsistency(
    cleanTradeline({ field_17A_account_status: observed("13"), field_21_current_balance: observed(210000) })
  );
  assertWellFormed(v, "M2-011");
  assert.equal(v.severity, "strong");
  assert.equal(v.field, "21");
  assert.equal(v.observed, 210000);
  assert.equal(v.expected, 0);
  assert.match(v.reason, /\$2,100\.00/);
});

test("M2-011 fires on every zero-balance status, not just 13", () => {
  for (const status of ["05", "61", "62", "63", "64", "65"]) {
    const found = checkStatusBalanceConsistency(
      cleanTradeline({ field_17A_account_status: observed(status), field_21_current_balance: observed(500) })
    );
    assert.equal(found.length, 1, `status ${status} should trip M2-011`);
  }
});

test("M2-011 does not fire when a paid status carries a $0 balance", () => {
  assert.deepEqual(
    checkStatusBalanceConsistency(
      cleanTradeline({ field_17A_account_status: observed("13"), field_21_current_balance: observed(0) })
    ),
    []
  );
});

test("M2-011 does not fire on a charge-off with a balance — Exhibit 4 permits one", () => {
  assert.deepEqual(
    checkStatusBalanceConsistency(
      cleanTradeline({ field_17A_account_status: observed("97"), field_21_current_balance: observed(210000) })
    ),
    []
  );
});

test("M2-011 does not fire when status or balance is not visible", () => {
  assert.deepEqual(checkStatusBalanceConsistency(blindTradeline()), []);
  assert.deepEqual(
    checkStatusBalanceConsistency(
      cleanTradeline({ field_17A_account_status: notVisible(), field_21_current_balance: observed(210000) })
    ),
    []
  );
  assert.deepEqual(
    checkStatusBalanceConsistency(
      cleanTradeline({ field_17A_account_status: observed("13"), field_21_current_balance: notVisible() })
    ),
    []
  );
});

// ── M2-012 — 17A + 22 ──────────────────────────────────────────────────────

test("M2-012 fires when a current account reports an amount past due", () => {
  const [v] = checkStatusPastDueConsistency(
    cleanTradeline({ field_17A_account_status: observed("11"), field_22_amount_past_due: observed(45000) })
  );
  assertWellFormed(v, "M2-012");
  assert.equal(v.subcase, "past_due_on_current_or_paid_status");
  assert.match(v.reason, /knowledge base identifies this status/);
});

test("M2-012 fires when a paid-in-full status reports arrears, and says the rule is implied", () => {
  const [v] = checkStatusPastDueConsistency(
    cleanTradeline({ field_17A_account_status: observed("64"), field_22_amount_past_due: observed(1000) })
  );
  assert.equal(v.subcase, "past_due_on_current_or_paid_status");
  assert.match(v.reason, /cannot simultaneously carry arrears/);
});

test("M2-012 fires when a delinquent status reports nothing past due", () => {
  const [v] = checkStatusPastDueConsistency(
    cleanTradeline({ field_17A_account_status: observed("84"), field_22_amount_past_due: observed(0) })
  );
  assert.equal(v.subcase, "no_past_due_on_delinquent_status");
  assert.match(v.reason, /Exhibit 4 requires an Amount Past Due above/);
});

test("M2-012 does not fire on a current account with nothing past due", () => {
  assert.deepEqual(checkStatusPastDueConsistency(cleanTradeline()), []);
});

test("M2-012 does not fire on a delinquent status that does report arrears", () => {
  assert.deepEqual(
    checkStatusPastDueConsistency(
      cleanTradeline({ field_17A_account_status: observed("84"), field_22_amount_past_due: observed(90000) })
    ),
    []
  );
});

test("M2-012 does not fire when Amount Past Due is not visible", () => {
  assert.deepEqual(
    checkStatusPastDueConsistency(
      cleanTradeline({ field_17A_account_status: observed("11"), field_22_amount_past_due: notVisible() })
    ),
    []
  );
});

// ── M2-013 — 17A + 17B ─────────────────────────────────────────────────────

test("M2-013 fires when a charge-off reports a Payment Rating other than L", () => {
  const [v] = checkStatusPaymentRatingConsistency(
    cleanTradeline({ field_17A_account_status: observed("97"), field_17B_payment_rating: observed("0") })
  );
  assertWellFormed(v, "M2-013");
  assert.equal(v.subcase, "chargeoff_without_rating_L");
  assert.equal(v.severity, "strong");
  assert.equal(v.expected, "L");
});

test("M2-013 fires when a charge-off reports no Payment Rating at all", () => {
  const [v] = checkStatusPaymentRatingConsistency(
    cleanTradeline({ field_17A_account_status: observed("97"), field_17B_payment_rating: absent() })
  );
  assert.equal(v.subcase, "chargeoff_without_rating_L");
});

test("M2-013 fires as a moderate omission when another status requiring 17B has none", () => {
  const [v] = checkStatusPaymentRatingConsistency(
    cleanTradeline({ field_17A_account_status: observed("13"), field_17B_payment_rating: absent() })
  );
  assert.equal(v.subcase, "payment_rating_absent");
  assert.equal(v.severity, "moderate");
});

test("M2-013 fires on a Payment Rating outside the nine permitted values", () => {
  const [v] = checkStatusPaymentRatingConsistency(
    cleanTradeline({ field_17A_account_status: observed("97"), field_17B_payment_rating: observed("C") })
  );
  assert.equal(v.subcase, "payment_rating_invalid");
});

test("M2-013 does not fire on a charge-off correctly rated L", () => {
  assert.deepEqual(
    checkStatusPaymentRatingConsistency(
      cleanTradeline({ field_17A_account_status: observed("97"), field_17B_payment_rating: observed("L") })
    ),
    []
  );
});

test("M2-013 does not fire on statuses 71-84, where the knowledge base contradicts itself", () => {
  // Exhibit 4's notes require 17B here; § 1.5's list does not. The engine takes
  // the narrower reading rather than claim a violation the document undercuts.
  for (const status of ["71", "78", "80", "82", "83", "84"]) {
    assert.deepEqual(
      checkStatusPaymentRatingConsistency(
        cleanTradeline({ field_17A_account_status: observed(status), field_17B_payment_rating: absent() })
      ),
      [],
      `status ${status} must not trip M2-013 on the narrow reading`
    );
  }
});

test("M2-013 does not fire when the Payment Rating field is not carried by the report", () => {
  assert.deepEqual(
    checkStatusPaymentRatingConsistency(
      cleanTradeline({ field_17A_account_status: observed("97"), field_17B_payment_rating: notVisible() })
    ),
    []
  );
});

// ── M2-014 — 17A + 18 ──────────────────────────────────────────────────────

test("M2-014 fires when a current account's history shows late months", () => {
  const [v] = checkStatusPaymentHistoryConsistency(
    cleanTradeline({
      field_17A_account_status: observed("11"),
      field_18_payment_history: observed("000220000000000000000000")
    })
  );
  assertWellFormed(v, "M2-014");
  assert.equal(v.subcase, "late_history_on_current_status");
  assert.deepEqual(v.observed.latePositions, [3, 4]);
});

test("M2-014 fires when the history marks a charge-off before the DOFD", () => {
  // Anchor is Field 24 = 2026-08-01, so index 0 is 2026-08 and index 5 is 2026-03.
  const [v] = checkStatusPaymentHistoryConsistency(
    cleanTradeline({
      field_17A_account_status: observed("97"),
      field_18_payment_history: observed("00000L000000000000000000"),
      field_24_date_of_account_info: observed("2026-08-01"),
      field_25_dofd: observed("2026-06-01")
    })
  );
  assert.equal(v.subcase, "php_chargeoff_before_dofd");
  assert.deepEqual(v.observed.months, ["2026-03"]);
});

test("M2-014 does not fire on a clean 24-month history", () => {
  assert.deepEqual(checkStatusPaymentHistoryConsistency(cleanTradeline()), []);
});

test("M2-014 does not fire when the charge-off months all follow the DOFD", () => {
  assert.deepEqual(
    checkStatusPaymentHistoryConsistency(
      cleanTradeline({
        field_17A_account_status: observed("97"),
        field_18_payment_history: observed("LL0000000000000000000000"),
        field_24_date_of_account_info: observed("2026-08-01"),
        field_25_dofd: observed("2025-01-01")
      })
    ),
    []
  );
});

test("M2-014 does not fire when the payment history is not visible", () => {
  assert.deepEqual(
    checkStatusPaymentHistoryConsistency(
      cleanTradeline({ field_17A_account_status: observed("11"), field_18_payment_history: notVisible() })
    ),
    []
  );
});

// ── M2-015 — 17A prohibited sequence ───────────────────────────────────────

test("M2-015 fires when a charge-off follows a deed in lieu", () => {
  const context = cleanContext({
    priorStatusReports: observed([{ status: "89", reportedOn: "2025-11-01" }])
  });
  const [v] = checkProhibitedStatusSequence(cleanTradeline({ field_17A_account_status: observed("97") }), context);
  assertWellFormed(v, "M2-015");
  assert.equal(v.observed.prior, "89");
});

test("M2-015 fires when a charge-off follows a completed foreclosure", () => {
  const context = cleanContext({ priorStatusReports: observed([{ status: "94", reportedOn: "2025-02-01" }]) });
  assert.equal(
    checkProhibitedStatusSequence(cleanTradeline({ field_17A_account_status: observed("97") }), context).length,
    1
  );
});

test("M2-015 does not fire on a permitted sequence", () => {
  const context = cleanContext({ priorStatusReports: observed([{ status: "84", reportedOn: "2025-11-01" }]) });
  assert.deepEqual(
    checkProhibitedStatusSequence(cleanTradeline({ field_17A_account_status: observed("97") }), context),
    []
  );
});

test("M2-015 does not fire without a reporting history to compare against", () => {
  assert.deepEqual(
    checkProhibitedStatusSequence(cleanTradeline({ field_17A_account_status: observed("97") }), cleanContext()),
    []
  );
});

// ── M2-016 — 17A + 19 ──────────────────────────────────────────────────────

test("M2-016 fires when comment AU requires a paid status but the account is charged off", () => {
  const [v] = checkSpecialCommentConsistency(
    cleanTradeline({
      field_19_special_comment: observed("AU"),
      field_17A_account_status: observed("97"),
      field_21_current_balance: observed(210000)
    })
  );
  assertWellFormed(v, "M2-016");
  assert.equal(v.field, "19");
  assert.equal(v.expected, "Status 13 or 61–65, balance = 0");
});

test("M2-016 fires when comment H requires ECOA T and the account reports ECOA 1", () => {
  const [v] = checkSpecialCommentConsistency(cleanTradeline({ field_19_special_comment: observed("H") }));
  assert.match(v.reason, /ECOA Code is 1, but this comment requires T/);
});

test("M2-016 fires when comment M requires a Date Closed and none is reported", () => {
  const [v] = checkSpecialCommentConsistency(
    cleanTradeline({ field_19_special_comment: observed("M"), field_26_date_closed: absent() })
  );
  assert.match(v.reason, /no Date Closed is reported/);
});

test("M2-016 fires when forbearance comment CP sits on a zero balance", () => {
  const [v] = checkSpecialCommentConsistency(
    cleanTradeline({ field_19_special_comment: observed("CP"), field_21_current_balance: observed(0) })
  );
  assert.match(v.reason, /requires a balance/);
});

test("M2-016 does not fire when the comment's conditions are all met", () => {
  assert.deepEqual(
    checkSpecialCommentConsistency(
      cleanTradeline({
        field_19_special_comment: observed("AU"),
        field_17A_account_status: observed("13"),
        field_21_current_balance: observed(0)
      })
    ),
    []
  );
});

test("M2-016 does not fire on a comment code the knowledge base's Exhibit 7 excerpt omits", () => {
  // Exhibit 7 is reproduced as "(Selected)", so an unknown code may simply be
  // one the document does not carry. Calling it invalid would invent a finding.
  assert.deepEqual(checkSpecialCommentConsistency(cleanTradeline({ field_19_special_comment: observed("CS") })), []);
});

test("M2-016 does not fire on a comment with no stated condition", () => {
  assert.deepEqual(checkSpecialCommentConsistency(cleanTradeline({ field_19_special_comment: observed("AW") })), []);
});

// ── M2-017 — collector using a prohibited status ───────────────────────────

test("M2-017 fires when a debt buyer reports a status only the original creditor may use", () => {
  const [v] = checkCollectorProhibitedStatus(
    cleanTradeline({
      furnisher_is_third_party_collector: observed(true),
      field_17A_account_status: observed("97")
    })
  );
  assertWellFormed(v, "M2-017");
  assert.deepEqual(v.expected, ["62", "93", "DA", "DF"]);
});

test("M2-017 does not fire on any of the four statuses a collector may use", () => {
  for (const status of ["62", "93", "DA", "DF"]) {
    assert.deepEqual(
      checkCollectorProhibitedStatus(
        cleanTradeline({ furnisher_is_third_party_collector: observed(true), field_17A_account_status: observed(status) })
      ),
      [],
      `collector status ${status} is permitted`
    );
  }
});

test("M2-017 does not fire on an original creditor reporting a charge-off", () => {
  assert.deepEqual(
    checkCollectorProhibitedStatus(
      cleanTradeline({ furnisher_is_third_party_collector: observed(false), field_17A_account_status: observed("97") })
    ),
    []
  );
});

test("M2-017 does not fire when we cannot see whether the furnisher is a collector", () => {
  assert.deepEqual(
    checkCollectorProhibitedStatus(
      cleanTradeline({ furnisher_is_third_party_collector: notVisible(), field_17A_account_status: observed("97") })
    ),
    []
  );
});
