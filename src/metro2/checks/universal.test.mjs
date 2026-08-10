// § 5.1 universal checks — M2-001 … M2-010.
//
// Every rule gets a positive fixture that must trip it and a negative fixture
// that must not. The negative case is the one that matters: this engine's worst
// failure mode is claiming a violation that is not there, because a letter
// citing a defect the file does not contain is evidence the dispute was
// machine-generated and can be discarded without investigation.

import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAccountNumberAccuracy,
  checkDateOpenedAcrossBureaus,
  checkPortfolioType,
  checkAccountType,
  checkStaleAccountInformation,
  checkDofdPresentAndConsistent,
  checkSevenYearWindowExpired,
  checkEcoaCode,
  checkConsumerInformationIndicator,
  checkComplianceConditionCode,
  isDerogatoryAccount
} from "./universal.mjs";
import {
  cleanTradeline,
  cleanContext,
  blindTradeline,
  blindContext,
  bareContext,
  observed,
  absent,
  notVisible,
  AS_OF
} from "./fixtures/tradelines.mjs";

/** Every violation carries the keys the letter generator relies on. */
function assertWellFormed(v, ruleId) {
  assert.equal(v.ruleId, ruleId);
  assert.ok(["deletion", "strong", "moderate", "supporting"].includes(v.severity), "severity must be a known tier");
  assert.ok(typeof v.reason === "string" && v.reason.length > 20, "reason must read as a sentence");
  assert.ok(Array.isArray(v.citations) && v.citations.length > 0, "must carry citations");
  assert.ok(typeof v.metro2Ref === "string" && v.metro2Ref.length > 0, "must carry a Metro 2 reference");
}

// ── M2-001 — Field 7, account number ───────────────────────────────────────

test("M2-001 fires when the account number matches none the consumer holds", () => {
  const [v, ...rest] = checkAccountNumberAccuracy(
    cleanTradeline({ account_number_last4: observed("9987") }),
    cleanContext()
  );
  assert.equal(rest.length, 0);
  assertWellFormed(v, "M2-001");
  assert.equal(v.field, "7");
  assert.equal(v.observed, "9987");
});

test("M2-001 does not fire when the last four digits match", () => {
  assert.deepEqual(checkAccountNumberAccuracy(cleanTradeline(), cleanContext()), []);
  // A consumer who supplies the full number still matches a last-four report.
  assert.deepEqual(
    checkAccountNumberAccuracy(
      cleanTradeline(),
      cleanContext({ consumer: { ...cleanContext().consumer, knownAccountNumbers: observed(["5291-0713-3011-4521"]) } })
    ),
    []
  );
});

test("M2-001 stays silent with no consumer account numbers to compare against", () => {
  assert.deepEqual(checkAccountNumberAccuracy(cleanTradeline({ account_number_last4: observed("9987") }), blindContext()), []);
  assert.deepEqual(checkAccountNumberAccuracy(blindTradeline(), cleanContext()), []);
});

// ── M2-002 — Field 10, Date Opened across bureaus ──────────────────────────

test("M2-002 fires when another bureau reports a different Date Opened", () => {
  const context = cleanContext({
    bureauPeers: [{ bureau: observed("TU"), date_opened: observed("2020-11-02") }]
  });
  const [v] = checkDateOpenedAcrossBureaus(cleanTradeline(), context);
  assertWellFormed(v, "M2-002");
  assert.equal(v.field, "10");
  assert.equal(v.observed.peers[0].date_opened, "2020-11-02");
});

test("M2-002 does not fire when every bureau agrees", () => {
  const context = cleanContext({
    bureauPeers: [{ bureau: observed("TU"), date_opened: observed("2019-03-15") }]
  });
  assert.deepEqual(checkDateOpenedAcrossBureaus(cleanTradeline(), context), []);
});

test("M2-002 does not fire on a peer whose Date Opened is not visible", () => {
  const context = cleanContext({ bureauPeers: [{ bureau: observed("TU"), date_opened: notVisible() }] });
  assert.deepEqual(checkDateOpenedAcrossBureaus(cleanTradeline(), context), []);
});

// ── M2-003 — Field 8, Portfolio Type ───────────────────────────────────────

test("M2-003 fires when Portfolio Type contradicts the consumer's account", () => {
  const [v] = checkPortfolioType(cleanTradeline({ portfolio_type: observed("I") }), cleanContext());
  assertWellFormed(v, "M2-003");
  assert.equal(v.observed, "I");
  assert.equal(v.expected, "R");
});

test("M2-003 does not fire when Portfolio Type is right", () => {
  assert.deepEqual(checkPortfolioType(cleanTradeline(), cleanContext()), []);
});

test("M2-003 stays silent with no consumer statement about the product", () => {
  assert.deepEqual(checkPortfolioType(cleanTradeline({ portfolio_type: observed("I") }), bareContext()), []);
});

// ── M2-004 — Field 9, Account Type ─────────────────────────────────────────

test("M2-004 fires when the industry code contradicts the consumer's account", () => {
  const [v] = checkAccountType(cleanTradeline({ account_type: observed("48") }), cleanContext());
  assertWellFormed(v, "M2-004");
  assert.equal(v.expected, "18");
});

test("M2-004 does not fire when the industry code is right", () => {
  assert.deepEqual(checkAccountType(cleanTradeline(), cleanContext()), []);
});

// ── M2-005 — Field 24, stale Date of Account Information ───────────────────

test("M2-005 fires when the as-of date is more than 30 days old", () => {
  const [v] = checkStaleAccountInformation(
    cleanTradeline({ field_24_date_of_account_info: observed("2026-05-01") }),
    cleanContext()
  );
  assertWellFormed(v, "M2-005");
  assert.equal(v.field, "24");
  assert.equal(v.observed, "2026-05-01");
});

test("M2-005 does not fire inside the 30-day window, including exactly on it", () => {
  assert.deepEqual(checkStaleAccountInformation(cleanTradeline(), cleanContext()), []);
  assert.deepEqual(
    checkStaleAccountInformation(
      cleanTradeline({ field_24_date_of_account_info: observed("2026-07-08") }),
      cleanContext()
    ),
    []
  );
});

test("M2-005 respects a caller-supplied window", () => {
  const context = cleanContext({ options: { staleDoaiDays: 3 } });
  assert.equal(checkStaleAccountInformation(cleanTradeline(), context).length, 1);
});

// ── M2-006 — Field 25, DOFD present and consistent ─────────────────────────

test("M2-006 fires as a deletion finding when a collection has no DOFD", () => {
  const [v] = checkDofdPresentAndConsistent(
    cleanTradeline({ field_17A_account_status: observed("93"), field_25_dofd: absent() }),
    cleanContext()
  );
  assertWellFormed(v, "M2-006");
  assert.equal(v.subcase, "dofd_missing_on_derogatory");
  assert.equal(v.severity, "deletion");
});

test("M2-006 does not fire for a missing DOFD on a current account", () => {
  // A current credit card has no first delinquency. Firing here would be an
  // invented violation, and § 1.6 scopes the rule to collections and charge-offs.
  assert.deepEqual(checkDofdPresentAndConsistent(cleanTradeline(), cleanContext()), []);
});

test("M2-006 fires as re-aging evidence when bureaus disagree on the DOFD", () => {
  const context = cleanContext({
    bureauPeers: [{ bureau: observed("EX"), field_25_dofd: observed("2021-06-01") }]
  });
  const [v] = checkDofdPresentAndConsistent(cleanTradeline({ field_25_dofd: observed("2019-06-01") }), context);
  assert.equal(v.subcase, "dofd_mismatch_across_bureaus");
  assert.equal(v.severity, "strong");
});

test("M2-006 fires when the DOFD is after the report date", () => {
  const [v] = checkDofdPresentAndConsistent(cleanTradeline({ field_25_dofd: observed("2026-12-01") }), cleanContext());
  assert.equal(v.subcase, "dofd_future");
});

test("M2-006 does not fire on a DOFD that agrees everywhere and is in the past", () => {
  const context = cleanContext({
    bureauPeers: [{ bureau: observed("EX"), field_25_dofd: observed("2019-06-01") }]
  });
  assert.deepEqual(checkDofdPresentAndConsistent(cleanTradeline({ field_25_dofd: observed("2019-06-01") }), context), []);
});

test("M2-006 does not fire on a not_visible DOFD, whatever the status", () => {
  assert.deepEqual(
    checkDofdPresentAndConsistent(
      cleanTradeline({ field_17A_account_status: observed("93"), field_25_dofd: notVisible() }),
      cleanContext()
    ),
    []
  );
});

// ── M2-007 — Field 25, seven-year window ───────────────────────────────────

test("M2-007 fires once DOFD plus seven years and 180 days has passed", () => {
  // 2019-01-01 + 7y = 2026-01-01, + 180 days = 2026-06-30, before 2026-08-07.
  const [v] = checkSevenYearWindowExpired(cleanTradeline({ field_25_dofd: observed("2019-01-01") }), cleanContext());
  assertWellFormed(v, "M2-007");
  assert.equal(v.severity, "deletion");
  assert.equal(v.observed.obsoleteOn, "2026-06-30");
});

test("M2-007 does not fire while the window is still open", () => {
  // 2019-06-01 + 7y + 180d = 2026-11-28, after the report date.
  assert.deepEqual(
    checkSevenYearWindowExpired(cleanTradeline({ field_25_dofd: observed("2019-06-01") }), cleanContext()),
    []
  );
});

test("M2-007 does not fire on the exact expiry date — the window has not passed yet", () => {
  // DOFD chosen so the deadline lands exactly on the report date.
  assert.deepEqual(
    checkSevenYearWindowExpired(cleanTradeline({ field_25_dofd: observed("2019-02-08") }), cleanContext()),
    []
  );
});

// ── M2-008 — Field 37, ECOA ────────────────────────────────────────────────

test("M2-008 fires on an ECOA code obsolete since 2003", () => {
  const [v] = checkEcoaCode(cleanTradeline({ field_37_ecoa: observed("4") }), cleanContext());
  assertWellFormed(v, "M2-008");
  assert.match(v.reason, /obsolete since 2003/);
});

test("M2-008 fires on an ECOA code Exhibit 10 does not define", () => {
  const [v] = checkEcoaCode(cleanTradeline({ field_37_ecoa: observed("Q") }), cleanContext());
  assertWellFormed(v, "M2-008");
  assert.match(v.reason, /not a code Exhibit 10 defines/);
});

test("M2-008 fires when the consumer is only an authorized user but is reported as individually liable", () => {
  const context = cleanContext({ expected: { ...cleanContext().expected, ecoa: observed("3") } });
  const [v] = checkEcoaCode(cleanTradeline(), context);
  assert.equal(v.observed, "1");
  assert.equal(v.expected, "3");
});

test("M2-008 does not fire on a valid code matching the consumer's relationship", () => {
  assert.deepEqual(checkEcoaCode(cleanTradeline(), cleanContext()), []);
});

test("M2-008 does not fire on a valid code with no consumer statement to compare", () => {
  assert.deepEqual(checkEcoaCode(cleanTradeline(), bareContext()), []);
});

// ── M2-009 — Field 38, CII appropriateness ─────────────────────────────────

test("M2-009 fires on a CII code Exhibit 11 does not define", () => {
  const [v] = checkConsumerInformationIndicator(cleanTradeline({ field_38_cii: observed("ZZ") }), cleanContext());
  assertWellFormed(v, "M2-009");
  assert.match(v.reason, /not a code Exhibit 11 defines/);
});

test("M2-009 fires when a discharge is reported but no discharge happened", () => {
  const [v] = checkConsumerInformationIndicator(cleanTradeline({ field_38_cii: observed("E") }), cleanContext());
  assertWellFormed(v, "M2-009");
  assert.match(v.reason, /no bankruptcy discharge applies/);
});

test("M2-009 fires when the reported chapter contradicts the consumer's bankruptcy", () => {
  const context = cleanContext({
    bankruptcy: { included: observed(true), discharged: observed(true), dismissed: observed(false), chapter: observed("13") }
  });
  const [v] = checkConsumerInformationIndicator(cleanTradeline({ field_38_cii: observed("E") }), context);
  assert.equal(v.expected, "H");
});

test("M2-009 does not fire when the indicator matches the actual bankruptcy", () => {
  const context = cleanContext({
    bankruptcy: { included: observed(true), discharged: observed(true), dismissed: observed(false), chapter: observed("7") }
  });
  assert.deepEqual(checkConsumerInformationIndicator(cleanTradeline({ field_38_cii: observed("E") }), context), []);
});

test("M2-009 does not fire on an empty Field 38 — a missing indicator is M2-024", () => {
  assert.deepEqual(checkConsumerInformationIndicator(cleanTradeline(), cleanContext()), []);
});

// ── M2-010 — Field 20, CCC structural validity ─────────────────────────────

test("M2-010 fires on a compliance code Exhibit 8 does not define", () => {
  const [v] = checkComplianceConditionCode(
    cleanTradeline({ field_20_compliance_condition: observed("XZ") }),
    cleanContext()
  );
  assertWellFormed(v, "M2-010");
  assert.match(v.reason, /not a code Exhibit 8 defines/);
});

test("M2-010 fires when XA is reported with no Date Closed", () => {
  const [v] = checkComplianceConditionCode(
    cleanTradeline({ field_20_compliance_condition: observed("XA"), field_26_date_closed: absent() }),
    cleanContext()
  );
  assertWellFormed(v, "M2-010");
  assert.match(v.reason, /no Date Closed is reported/);
});

test("M2-010 does not fire when XA carries its Date Closed", () => {
  assert.deepEqual(
    checkComplianceConditionCode(
      cleanTradeline({ field_20_compliance_condition: observed("XA"), field_26_date_closed: observed("2025-06-30") }),
      cleanContext()
    ),
    []
  );
});

test("M2-010 does not fire when Date Closed is not visible", () => {
  assert.deepEqual(
    checkComplianceConditionCode(
      cleanTradeline({ field_20_compliance_condition: observed("XA"), field_26_date_closed: notVisible() }),
      cleanContext()
    ),
    []
  );
});

// ── The derogatory-account helper ──────────────────────────────────────────

test("isDerogatoryAccount answers null rather than false when it cannot tell", () => {
  assert.equal(isDerogatoryAccount(blindTradeline()), null);
  assert.equal(isDerogatoryAccount(cleanTradeline()), false);
  assert.equal(isDerogatoryAccount(cleanTradeline({ field_17A_account_status: observed("97") })), true);
  assert.equal(isDerogatoryAccount(cleanTradeline({ furnisher_is_third_party_collector: observed(true) })), true);
});

test("the report date used by every fixture is fixed, so these tests do not read the clock", () => {
  assert.equal(AS_OF, "2026-08-07");
});
