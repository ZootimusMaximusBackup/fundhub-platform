// § 5.4 bankruptcy — M2-024 … M2-027.
//
// M2-025 is the strongest finding the engine produces, so it gets the most
// negative fixtures. The one that matters most is the dismissed case: a
// bankruptcy that was dismissed produced no discharge, the debt survives, and a
// balance on it is correct. Firing there would demand deletion of an accurate
// tradeline.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkMissingPostDischargeCii,
  checkDischargedAccountWithBalance,
  checkAuthorizedUserInBankruptcy,
  checkDelinquentStatusOnDischarged
} from "./bankruptcy.mjs";
import { cleanTradeline, cleanContext, blindContext, observed, absent, notVisible } from "./fixtures/tradelines.mjs";

function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.ok(["deletion", "strong", "moderate", "supporting"].includes(v.severity));
  assert.ok(typeof v.reason === "string" && v.reason.length > 20);
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0);
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0);
}

/** A consumer whose Chapter 7 discharged. */
function dischargedContext(overrides = {}) {
  return cleanContext({
    bankruptcy: {
      included: observed(true),
      discharged: observed(true),
      dismissed: observed(false),
      chapter: observed("7"),
      ...overrides
    }
  });
}

// ── M2-024 — missing post-discharge CII ────────────────────────────────────

test("M2-024 fires when a discharged account carries no bankruptcy indicator", () => {
  const [v] = checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: absent() }), dischargedContext());
  assertWellFormed(v, "M2-024");
  assert.equal(v.field, "38");
  assert.equal(v.expected, "E");
  assert.equal(v.severity, "strong");
});

test("M2-024 fires when the indicator only records the petition, not the discharge", () => {
  const [v] = checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: observed("A") }), dischargedContext());
  assertWellFormed(v, "M2-024");
  assert.equal(v.observed, "A");
});

test("M2-024 does not fire when the discharge indicator is present", () => {
  assert.deepEqual(checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: observed("E") }), dischargedContext()), []);
});

test("M2-024 does not fire when no bankruptcy discharge is on record", () => {
  assert.deepEqual(checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: absent() }), cleanContext()), []);
  assert.deepEqual(checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: absent() }), blindContext()), []);
});

test("M2-024 does not fire when Field 38 is not visible", () => {
  assert.deepEqual(checkMissingPostDischargeCii(cleanTradeline({ field_38_cii: notVisible() }), dischargedContext()), []);
});

// ── M2-025 — discharged account with a balance ─────────────────────────────

test("M2-025 fires as a deletion finding when a discharged account still shows a balance", () => {
  const [v] = checkDischargedAccountWithBalance(
    cleanTradeline({ field_38_cii: observed("E"), field_21_current_balance: observed(430000) }),
    cleanContext()
  );
  assertWellFormed(v, "M2-025");
  assert.equal(v.severity, "deletion");
  assert.match(v.reason, /\$4,300\.00/);
  assert.match(v.reason, /discharged debt is no longer owed/);
});

test("M2-025 fires on arrears as well as a balance", () => {
  const [v] = checkDischargedAccountWithBalance(
    cleanTradeline({
      field_38_cii: observed("H"),
      field_21_current_balance: observed(0),
      field_22_amount_past_due: observed(90000)
    }),
    cleanContext()
  );
  assert.equal(v.field, "22");
});

test("M2-025 does not fire on a discharged account correctly reporting $0", () => {
  assert.deepEqual(
    checkDischargedAccountWithBalance(
      cleanTradeline({
        field_38_cii: observed("E"),
        field_21_current_balance: observed(0),
        field_22_amount_past_due: observed(0)
      }),
      cleanContext()
    ),
    []
  );
});

test("M2-025 does not fire when the bankruptcy was dismissed — the debt survives a dismissal", () => {
  const dismissed = cleanContext({
    bankruptcy: { included: observed(true), discharged: observed(false), dismissed: observed(true), chapter: observed("7") }
  });
  assert.deepEqual(
    checkDischargedAccountWithBalance(
      cleanTradeline({ field_38_cii: observed("E"), field_21_current_balance: observed(430000) }),
      dismissed
    ),
    []
  );
});

test("M2-025 does not fire on a petition indicator — a filing is not a discharge", () => {
  assert.deepEqual(
    checkDischargedAccountWithBalance(
      cleanTradeline({ field_38_cii: observed("A"), field_21_current_balance: observed(430000) }),
      cleanContext()
    ),
    []
  );
});

test("M2-025 does not fire when Field 38 is not visible", () => {
  assert.deepEqual(
    checkDischargedAccountWithBalance(
      cleanTradeline({ field_38_cii: notVisible(), field_21_current_balance: observed(430000) }),
      cleanContext()
    ),
    []
  );
});

// ── M2-026 — authorized user in bankruptcy ─────────────────────────────────

test("M2-026 fires when an authorized user's bankrupt account is not removed with Code Z", () => {
  const [v] = checkAuthorizedUserInBankruptcy(cleanTradeline({ field_37_ecoa: observed("3") }), dischargedContext());
  assertWellFormed(v, "M2-026");
  assert.equal(v.expected, "Z");
  assert.equal(v.severity, "strong");
});

test("M2-026 does not fire on a contractually liable consumer", () => {
  assert.deepEqual(checkAuthorizedUserInBankruptcy(cleanTradeline({ field_37_ecoa: observed("1") }), dischargedContext()), []);
});

test("M2-026 does not fire on an authorized user with no bankruptcy", () => {
  assert.deepEqual(checkAuthorizedUserInBankruptcy(cleanTradeline({ field_37_ecoa: observed("3") }), cleanContext()), []);
});

test("M2-026 does not fire when the ECOA code is not visible", () => {
  assert.deepEqual(checkAuthorizedUserInBankruptcy(cleanTradeline({ field_37_ecoa: notVisible() }), dischargedContext()), []);
});

// ── M2-027 — delinquent status on a discharged account ─────────────────────

test("M2-027 fires when a discharged account is still reported as a charge-off", () => {
  const [v] = checkDelinquentStatusOnDischarged(
    cleanTradeline({ field_38_cii: observed("E"), field_17A_account_status: observed("97") })
  );
  assertWellFormed(v, "M2-027");
  assert.equal(v.severity, "strong");
  assert.match(v.expected, /Account Status 13/);
});

test("M2-027 fires across the delinquency tiers as well as the derogatory finals", () => {
  for (const status of ["71", "84", "93", "96"]) {
    assert.equal(
      checkDelinquentStatusOnDischarged(
        cleanTradeline({ field_38_cii: observed("H"), field_17A_account_status: observed(status) })
      ).length,
      1,
      `status ${status} on a discharged account should trip M2-027`
    );
  }
});

test("M2-027 does not fire on a discharged account reported as status 13", () => {
  assert.deepEqual(
    checkDelinquentStatusOnDischarged(
      cleanTradeline({ field_38_cii: observed("E"), field_17A_account_status: observed("13") })
    ),
    []
  );
});

test("M2-027 does not fire on a delinquent account with no discharge indicator", () => {
  assert.deepEqual(
    checkDelinquentStatusOnDischarged(cleanTradeline({ field_38_cii: absent(), field_17A_account_status: observed("97") })),
    []
  );
});

test("M2-027 does not fire when the status is not visible", () => {
  assert.deepEqual(
    checkDelinquentStatusOnDischarged(
      cleanTradeline({ field_38_cii: observed("E"), field_17A_account_status: notVisible() })
    ),
    []
  );
});
