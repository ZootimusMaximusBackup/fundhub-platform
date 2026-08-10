// § 5.3 charge-off and collection — M2-018 … M2-023.
//
// Four of these six rules depend on a fact the Metro 2 base segment does not
// carry in a form this repo can read — whether the furnisher is a third-party
// collector, and whether the debt is medical. So each of them has a test proving
// it stays silent when that fact is `not_visible`, which is the state a consumer
// soft pull leaves it in.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkChargeOffSoldBalance,
  checkCollectionMissingK1,
  checkChargeOffAmountMissing,
  checkDoubleReporting,
  checkMedicalDebtUnderThreshold,
  checkMedicalDebtTooSoon,
  isCollectionAccount,
  saleEvidence
} from "./chargeoff-collection.mjs";
import {
  cleanTradeline,
  cleanContext,
  blindTradeline,
  kbExampleCollection,
  observed,
  absent,
  notVisible
} from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.ok(["deletion", "strong", "moderate", "supporting"].includes(v.severity));
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

/** A sold charge-off: status 97, K2 populated, balance still showing. */
function soldChargeOff(overrides = {}) {
  return cleanTradeline({
    field_17A_account_status: observed("97"),
    field_17B_payment_rating: observed("L"),
    field_21_current_balance: observed(210000),
    field_23_original_chargeoff_amount: observed(210000),
    field_25_dofd: observed("2023-04-01"),
    k2_sold_to: observed("MIDLAND FUNDING LLC"),
    ...overrides
  });
}

// ── M2-018 — 21 + K2 ───────────────────────────────────────────────────────

test("M2-018 fires when a sold charge-off still reports a balance", () => {
  const [v, ...rest] = checkChargeOffSoldBalance(soldChargeOff(), cleanContext());
  assert.equal(rest.length, 0);
  assertWellFormed(v, "M2-018");
  assert.equal(v.subcase, "balance_after_sale");
  assert.equal(v.expected, 0);
  assert.match(v.reason, /K2 Sold To segment/);
});

test("M2-018 fires when a sale is evidenced by comment AH but no K2 Sold To is reported", () => {
  const found = checkChargeOffSoldBalance(
    soldChargeOff({ k2_sold_to: absent(), field_19_special_comment: observed("AH") }),
    cleanContext()
  );
  const subcases = found.map((v) => v.subcase).sort();
  assert.deepEqual(subcases, ["balance_after_sale", "k2_sold_to_absent"]);
});

test("M2-018 does not fire on a sold charge-off correctly zeroed out", () => {
  assert.deepEqual(
    checkChargeOffSoldBalance(soldChargeOff({ field_21_current_balance: observed(0) }), cleanContext()),
    []
  );
});

test("M2-018 does not fire on a charge-off with no evidence it was sold", () => {
  // Without a sale there is nothing wrong with a charge-off carrying a balance.
  assert.deepEqual(
    checkChargeOffSoldBalance(soldChargeOff({ k2_sold_to: absent() }), cleanContext()),
    []
  );
});

test("M2-018 does not fire when the K2 segment is not visible", () => {
  assert.deepEqual(
    checkChargeOffSoldBalance(soldChargeOff({ k2_sold_to: notVisible() }), cleanContext()),
    []
  );
});

test("saleEvidence names its source, and returns null when there is none", () => {
  assert.match(saleEvidence(soldChargeOff(), cleanContext()), /K2 Sold To/);
  assert.match(
    saleEvidence(soldChargeOff({ k2_sold_to: absent(), field_19_special_comment: observed("AH") }), cleanContext()),
    /Special Comment AH/
  );
  assert.equal(saleEvidence(soldChargeOff({ k2_sold_to: absent() }), cleanContext()), null);
  assert.equal(saleEvidence(blindTradeline(), cleanContext()), null);
});

// ── M2-019 — K1 on a collection ────────────────────────────────────────────

test("M2-019 fires when a collection reports no original creditor", () => {
  const [v] = checkCollectionMissingK1(kbExampleCollection());
  assertWellFormed(v, "M2-019");
  assert.equal(v.field, "K1");
  assert.equal(v.severity, "strong");
});

test("M2-019 fires on status 93 even when the collector flag is not visible", () => {
  const [v] = checkCollectionMissingK1(
    cleanTradeline({
      field_17A_account_status: observed("93"),
      furnisher_is_third_party_collector: notVisible(),
      k1_original_creditor: absent()
    })
  );
  assertWellFormed(v, "M2-019");
});

test("M2-019 does not fire when the collection names its original creditor", () => {
  assert.deepEqual(checkCollectionMissingK1(kbExampleCollection({ k1_original_creditor: observed("SYNCHRONY BANK") })), []);
});

test("M2-019 does not fire on an account that is not a collection", () => {
  assert.deepEqual(checkCollectionMissingK1(cleanTradeline()), []);
});

test("M2-019 does not fire when the K1 segment is not visible", () => {
  assert.deepEqual(checkCollectionMissingK1(kbExampleCollection({ k1_original_creditor: notVisible() })), []);
});

test("isCollectionAccount answers null rather than false when it cannot tell", () => {
  assert.equal(isCollectionAccount(blindTradeline()), null);
  assert.equal(isCollectionAccount(cleanTradeline()), false);
  assert.equal(isCollectionAccount(kbExampleCollection()), true);
});

// ── M2-020 — Field 23 on a charge-off ──────────────────────────────────────

test("M2-020 fires when a charge-off reports no original charge-off amount", () => {
  const [v] = checkChargeOffAmountMissing(soldChargeOff({ field_23_original_chargeoff_amount: absent() }));
  assertWellFormed(v, "M2-020");
  assert.equal(v.field, "23");
  assert.equal(v.severity, "moderate");
});

test("M2-020 does not fire when the charge-off amount is reported", () => {
  assert.deepEqual(checkChargeOffAmountMissing(soldChargeOff()), []);
});

test("M2-020 does not fire on a status that does not require Field 23", () => {
  assert.deepEqual(checkChargeOffAmountMissing(cleanTradeline({ field_23_original_chargeoff_amount: absent() })), []);
});

test("M2-020 does not fire when Field 23 is not visible", () => {
  assert.deepEqual(checkChargeOffAmountMissing(soldChargeOff({ field_23_original_chargeoff_amount: notVisible() })), []);
});

// ── M2-021 — double reporting ──────────────────────────────────────────────

test("M2-021 fires when both the original creditor and a collector report a balance", () => {
  const context = cleanContext({ relatedTradelines: observed([kbExampleCollection()]) });
  const [v] = checkDoubleReporting(soldChargeOff(), context);
  assertWellFormed(v, "M2-021");
  assert.equal(v.severity, "strong");
  assert.equal(v.observed.otherCreditor, "Midland Funding");
});

test("M2-021 does not fire when the party that sold the debt has zeroed its balance", () => {
  const context = cleanContext({ relatedTradelines: observed([kbExampleCollection()]) });
  assert.deepEqual(checkDoubleReporting(soldChargeOff({ field_21_current_balance: observed(0) }), context), []);
});

test("M2-021 does not fire between two ordinary accounts", () => {
  const context = cleanContext({ relatedTradelines: observed([cleanTradeline({ creditor: "AMEX" })]) });
  assert.deepEqual(checkDoubleReporting(cleanTradeline(), context), []);
});

test("M2-021 does not fire without the other accounts on the file", () => {
  assert.deepEqual(checkDoubleReporting(soldChargeOff(), cleanContext()), []);
});

// ── M2-022 — medical debt under the floor ──────────────────────────────────

test("M2-022 fires on a medical collection below $500", () => {
  const [v] = checkMedicalDebtUnderThreshold(
    cleanTradeline({ is_medical_debt: observed(true), field_21_current_balance: observed(24999) }),
    cleanContext()
  );
  assertWellFormed(v, "M2-022");
  assert.equal(v.severity, "deletion");
  assert.match(v.reason, /\$249\.99/);
});

test("M2-022 does not fire at or above the floor, nor on a paid $0 balance", () => {
  assert.deepEqual(
    checkMedicalDebtUnderThreshold(
      cleanTradeline({ is_medical_debt: observed(true), field_21_current_balance: observed(50000) }),
      cleanContext()
    ),
    []
  );
  assert.deepEqual(
    checkMedicalDebtUnderThreshold(
      cleanTradeline({ is_medical_debt: observed(true), field_21_current_balance: observed(0) }),
      cleanContext()
    ),
    []
  );
});

test("M2-022 does not fire when we cannot see whether the debt is medical", () => {
  assert.deepEqual(
    checkMedicalDebtUnderThreshold(
      cleanTradeline({ is_medical_debt: notVisible(), field_21_current_balance: observed(24999) }),
      cleanContext()
    ),
    []
  );
});

// ── M2-023 — medical debt inside the one-year wait ─────────────────────────

test("M2-023 fires on medical debt reported inside the 365-day wait", () => {
  const [v] = checkMedicalDebtTooSoon(
    cleanTradeline({ is_medical_debt: observed(true), field_25_dofd: observed("2026-03-01") }),
    cleanContext()
  );
  assertWellFormed(v, "M2-023");
  assert.equal(v.severity, "deletion");
  assert.equal(v.observed.daysElapsed, 159);
});

test("M2-023 does not fire once the wait has run", () => {
  assert.deepEqual(
    checkMedicalDebtTooSoon(
      cleanTradeline({ is_medical_debt: observed(true), field_25_dofd: observed("2024-01-01") }),
      cleanContext()
    ),
    []
  );
});

test("M2-023 does not fire when the DOFD is not visible", () => {
  assert.deepEqual(
    checkMedicalDebtTooSoon(
      cleanTradeline({ is_medical_debt: observed(true), field_25_dofd: notVisible() }),
      cleanContext()
    ),
    []
  );
});
