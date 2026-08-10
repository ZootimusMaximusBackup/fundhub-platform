// The normalizer, and the coverage report it feeds.
//
// The field names and enumeration values in these fixtures are copied from the
// CRS sandbox payload library. The VALUES are invented — no sandbox names,
// addresses, SSNs or dates of birth appear here, because a test fixture is the
// easiest place in a repo to leak something that looks like a real person.
//
// Most of these tests assert that a field is NOT readable. That is the point.
// Every one of them is a guard against a future edit that reconstructs a Metro 2
// code out of the vendor's prose, and each carries the reason in its name.

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTradeline,
  normalizeContext,
  normalizeFromCrs,
  attachBureauPeers,
  extractTradelineRecords,
  dollarsToCents,
  isoDate,
  lastFour,
  FIELD_SOURCES,
  PORTFOLIO_TYPE_FROM_ACCOUNT_TYPE,
  ECOA_FROM_OWNERSHIP_TYPE,
  BUREAU_FROM_SOURCE_TYPE
} from "./normalize.mjs";
import {
  crsFieldCoverage,
  ruleReadiness,
  contextCoverage,
  implementedRuleIds,
  RULE_INPUTS,
  COVERED_FIELDS
} from "./crs-field-coverage.mjs";
import { isObserved, isAbsent, isNotVisible, isField } from "./provenance.mjs";
import { runTradelineChecks, runReport } from "./checks/index.mjs";
import { PAYMENT_RATINGS } from "./rules/payment-ratings.mjs";
import { STATUS_CODES } from "./rules/status-codes.mjs";
import { SPECIAL_COMMENTS } from "./rules/special-comments.mjs";
import { ECOA_CODES } from "./rules/ecoa-codes.mjs";

const AS_OF = "2026-03-01";

/** A revolving card, reported clean, with every key the vendor sends populated. */
function crsTradeline(overrides = {}) {
  return {
    accountIdentifier: "5121080011112222",
    accountOpenedDate: "2019-06-12",
    accountOwnershipType: "Individual",
    accountReportedDate: "2026-02-15",
    accountStatusType: "Open",
    accountType: "Revolving",
    borrowerSourceType: "Borrower",
    creditorName: "EXAMPLE BANK NA",
    currentBalanceAmount: "1842",
    currentRatingCode: "C",
    currentRatingType: "AsAgreed",
    derogatoryDataIndicator: false,
    highBalanceAmount: "5000",
    lastActivityDate: "2026-02-15",
    monthlyPaymentAmount: "75",
    monthsReviewedCount: "60",
    pastDueAmount: "0",
    paymentPatternData: "CCCCCCCCCCCCCCCCCCCCCCCC",
    sourceType: "Equifax",
    subscriberCode: "123AB00001",
    ...overrides
  };
}

/** A whole CRS response, shaped as the sandbox library shows it. */
function crsPayload({ tradelines = [crsTradeline()], inquiries = [], creditFiles = null } = {}) {
  return {
    requestedBureaus: { transunion: false, experian: false, equifax: true },
    responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
    creditFiles:
      creditFiles ?? [
        {
          creditFileDetail: { creditFileInfileDate: "2002-01-17", creditFileResultStatusType: "FileReturned", sourceType: "Equifax" },
          aliases: [{ firstName: "SAMPLE", middleName: "Q", lastName: "TESTCASE" }],
          ssns: [{ ssn: "666000001" }],
          dobs: [{ dob: "1970-01-01" }],
          employments: [{ employerName: "EXAMPLE EMPLOYER", employmentStatusType: "Current", employmentReportedDate: "2020-04-01" }],
          addresses: [
            {
              borrowerResidencyType: "Current",
              addressLine1: "100 EXAMPLE ST",
              city: "SPRINGFIELD",
              state: "IL",
              postalCode: "62701",
              dateReported: "2026-02-01"
            }
          ]
        }
      ],
    inquiries,
    tradelines
  };
}

// ── Every field is wrapped ─────────────────────────────────────────────────

test("every emitted field carries provenance — nothing comes out bare", () => {
  const tradeline = normalizeTradeline(crsTradeline());
  for (const name of COVERED_FIELDS) {
    assert.ok(isField(tradeline[name]), `${name} must be a provenance wrapper`);
  }
  assert.ok(isField(tradeline.bureau_reporting));
});

test("the normalizer emits exactly the fields it documents, and no others", () => {
  const tradeline = normalizeTradeline(crsTradeline());
  const emitted = Object.keys(tradeline).filter((k) => k !== "raw" && k !== "bureau_reporting");
  assert.deepEqual([...emitted].sort(), [...COVERED_FIELDS].sort());
});

test("a record with neither creditor nor account number is not a tradeline", () => {
  assert.equal(normalizeTradeline({ sourceType: "Equifax" }), null);
  assert.equal(normalizeTradeline(null), null);
  assert.equal(normalizeTradeline("nope"), null);
});

// ── The fields CRS does give us ────────────────────────────────────────────

test("the readable fields come through with the right values", () => {
  const t = normalizeTradeline(crsTradeline());
  assert.equal(t.creditor.value, "EXAMPLE BANK NA");
  assert.equal(t.bureau.value, "EQ");
  assert.deepEqual(t.bureau_reporting.value, ["EQ"]);
  assert.equal(t.account_number_last4.value, "2222");
  assert.equal(t.portfolio_type.value, "R");
  assert.equal(t.date_opened.value, "2019-06-12");
  assert.equal(t.field_21_current_balance.value, 184200);
  assert.equal(t.field_22_amount_past_due.value, 0);
  assert.equal(t.field_24_date_of_account_info.value, "2026-02-15");
  assert.equal(t.field_37_ecoa.value, "1");
});

test("a field the vendor carries but did not send is absent, not invisible", () => {
  // The furnisher's own omission. Reportable, and several rules turn on it.
  const t = normalizeTradeline(crsTradeline({ accountClosedDate: undefined, chargeOffAmount: undefined }));
  assert.ok(isAbsent(t.field_26_date_closed));
  assert.ok(isAbsent(t.field_23_original_chargeoff_amount));
});

test("a charge-off amount is read when the vendor sends it", () => {
  const t = normalizeTradeline(crsTradeline({ chargeOffAmount: "2100" }));
  assert.equal(t.field_23_original_chargeoff_amount.value, 210000);
});

test("a zero balance survives as zero and never becomes unknown", () => {
  const t = normalizeTradeline(crsTradeline({ currentBalanceAmount: "0" }));
  assert.ok(isObserved(t.field_21_current_balance));
  assert.equal(t.field_21_current_balance.value, 0);
});

test("an unreported balance stays unknown and never becomes zero", () => {
  // The failure this guards against would satisfy M2-011 and trip M2-012 on
  // every account with no balance reported.
  for (const value of [undefined, null, "", "  ", "n/a"]) {
    const t = normalizeTradeline(crsTradeline({ currentBalanceAmount: value }));
    assert.ok(isAbsent(t.field_21_current_balance), `${JSON.stringify(value)} must not become 0`);
    assert.equal(t.field_21_current_balance.value, null);
  }
});

// ── The fields CRS does NOT give us ───────────────────────────────────────

test("Field 17A account status is never reconstructed from prose", () => {
  // Every combination the vendor can send. None of them produces a status code.
  const cases = [
    { accountStatusType: "Paid", currentRatingType: "AsAgreed", currentBalanceAmount: "0" },
    { accountStatusType: "Closed", currentRatingType: "ChargeOff", currentRatingCode: "9" },
    { accountStatusType: "Open", currentRatingType: "BankruptcyOrWageEarnerPlan" },
    { accountStatusType: "Transferred", currentRatingType: "Late60Days", currentRatingCode: "2" },
    { accountStatusType: "Open", currentRatingType: "TooNew", currentRatingCode: "N" },
    { accountStatusType: "Open", currentRatingType: "NoDataAvailable", currentRatingCode: "-" }
  ];
  for (const c of cases) {
    const t = normalizeTradeline(crsTradeline(c));
    assert.ok(
      isNotVisible(t.field_17A_account_status),
      `${c.accountStatusType}/${c.currentRatingType} must not produce a Metro 2 status code`
    );
  }
});

test("Field 17B is not read from currentRatingCode — the alphabets do not overlap", () => {
  for (const code of ["C", "N", "-", "1", "2", "7", "9"]) {
    const t = normalizeTradeline(crsTradeline({ currentRatingCode: code }));
    assert.ok(isNotVisible(t.field_17B_payment_rating));
  }
  // The vendor's C and N are not Field 17B codes at all, which is the evidence.
  for (const code of ["C", "N", "-"]) {
    assert.equal(Object.hasOwn(PAYMENT_RATINGS, code), false, `${code} is not a Field 17B rating`);
  }
});

test("Field 18 is not read from paymentPatternData — wrong length and wrong alphabet", () => {
  for (const pattern of ["C", "CCCCCCCCCCCCCCCCCCCCCCCC", "CCC111CCCXXX", "C".repeat(35)]) {
    const t = normalizeTradeline(crsTradeline({ paymentPatternData: pattern }));
    assert.ok(isNotVisible(t.field_18_payment_history));
  }
});

test("Field 19 is not read from bureau comment codes — the sandbox proves they clash", () => {
  // The sandbox sends commentCode "AV" with commentText "CHARGE". Exhibit 7's AV
  // is "First payment never received". Same code, unrelated meanings.
  assert.equal(SPECIAL_COMMENTS.AV.meaning, "First payment never received");
  const t = normalizeTradeline(
    crsTradeline({ comments: [{ commentCode: "AV", commentSourceType: "Equifax", commentType: "BureauRemarks", commentText: "CHARGE" }] })
  );
  assert.ok(isNotVisible(t.field_19_special_comment));
});

test("Field 20 stays invisible — no dispute flag reaches a consumer tradeline", () => {
  const t = normalizeTradeline(crsTradeline({ customerDisputeIndicator: false }));
  assert.ok(isNotVisible(t.field_20_compliance_condition));
});

test("DOFD is never derived from dated delinquencies", () => {
  // The earliest delinquency still on file is not the first delinquency. Deriving
  // one from the other would re-age the account in the furnisher's favour.
  const t = normalizeTradeline(
    crsTradeline({
      adverseRatings: { priorAdverseRatings: [{ adverseRatingDate: "2021-05-01", adverseRatingCode: "2" }] },
      comments: [{ commentText: "Late Dates: 2021-05, 2021-06" }]
    })
  );
  assert.ok(isNotVisible(t.field_25_dofd));
});

test("date of last payment is not taken from lastActivityDate or accountPaidDate", () => {
  const t = normalizeTradeline(crsTradeline({ lastActivityDate: "2026-02-15", accountPaidDate: "2025-11-30" }));
  assert.ok(isNotVisible(t.field_27_date_last_payment));
});

test("CII stays invisible — bankruptcy prose cannot tell a petition from a discharge", () => {
  const t = normalizeTradeline(
    crsTradeline({
      currentRatingType: "BankruptcyOrWageEarnerPlan",
      comments: [{ commentCode: "BC", commentText: "BANKRUPTCY DISCHARGED" }]
    })
  );
  assert.ok(isNotVisible(t.field_38_cii));
});

test("original creditor stays invisible — creditorName is the furnisher, not K1", () => {
  const t = normalizeTradeline(crsTradeline({ creditorName: "MIDLAND FUNDING LLC", businessType: "Finance" }));
  assert.equal(t.creditor.value, "MIDLAND FUNDING LLC");
  assert.ok(isNotVisible(t.k1_original_creditor));
});

test("sold-to and purchased-from stay invisible even when a comment mentions a sale", () => {
  const t = normalizeTradeline(crsTradeline({ comments: [{ commentText: "ACCOUNT TRANSFERRED OR SOLD" }] }));
  assert.ok(isNotVisible(t.k2_sold_to));
  assert.ok(isNotVisible(t.k2_purchased_from));
});

test("the collector and medical flags stay invisible — businessType is not an industry code", () => {
  for (const businessType of ["Banking", "Finance", "Miscellaneous", "Collection"]) {
    const t = normalizeTradeline(crsTradeline({ businessType }));
    assert.ok(isNotVisible(t.furnisher_is_third_party_collector));
    assert.ok(isNotVisible(t.is_medical_debt));
  }
});

// ── The three permitted translations ──────────────────────────────────────

test("portfolio type translates on the vendor's four matching names and nothing else", () => {
  assert.deepEqual(PORTFOLIO_TYPE_FROM_ACCOUNT_TYPE, { Revolving: "R", Installment: "I", Mortgage: "M", Open: "O" });
  for (const [vendor, metro2] of Object.entries(PORTFOLIO_TYPE_FROM_ACCOUNT_TYPE)) {
    assert.equal(normalizeTradeline(crsTradeline({ accountType: vendor })).portfolio_type.value, metro2);
  }
  for (const vendor of ["Unknown", "UnknownLoanType", "CreditLine", undefined, ""]) {
    assert.ok(
      isNotVisible(normalizeTradeline(crsTradeline({ accountType: vendor })).portfolio_type),
      `accountType ${JSON.stringify(vendor)} must not become a portfolio type`
    );
  }
});

test("ECOA translates only where Exhibit 10's own name matches the vendor's", () => {
  for (const [vendor, code] of Object.entries(ECOA_FROM_OWNERSHIP_TYPE)) {
    const t = normalizeTradeline(crsTradeline({ accountOwnershipType: vendor }));
    assert.equal(t.field_37_ecoa.value, code);
    assert.ok(Object.hasOwn(ECOA_CODES, code), `${code} must be a real Exhibit 10 code`);
    assert.equal(ECOA_CODES[code].obsolete ?? false, false, `${code} must not be a withdrawn code`);
  }
});

test("an ambiguous ownership type is refused rather than guessed", () => {
  // Mapping either of these to ECOA 2 would assert contractual liability for a
  // debt on the strength of a label that does not say so.
  for (const vendor of ["Joint", "JointParticipating", "Undesignated", "Guarantor", undefined]) {
    const t = normalizeTradeline(crsTradeline({ accountOwnershipType: vendor }));
    assert.ok(isNotVisible(t.field_37_ecoa), `${JSON.stringify(vendor)} must not become an ECOA code`);
  }
});

test("bureau translates on the three names and refuses anything else", () => {
  assert.deepEqual(BUREAU_FROM_SOURCE_TYPE, { TransUnion: "TU", Experian: "EX", Equifax: "EQ" });
  for (const source of ["Other", "CreditBureau", undefined]) {
    assert.ok(isNotVisible(normalizeTradeline(crsTradeline({ sourceType: source })).bureau));
  }
});

// ── Conversions ───────────────────────────────────────────────────────────

test("dollars become integer cents, and unreadable input becomes null", () => {
  assert.equal(dollarsToCents("1842"), 184200);
  assert.equal(dollarsToCents("1,842.50"), 184250);
  assert.equal(dollarsToCents("$2,100"), 210000);
  assert.equal(dollarsToCents(0), 0);
  assert.equal(dollarsToCents("0.05"), 5);
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents(null), null);
  assert.equal(dollarsToCents("unknown"), null);
});

test("dates must already be ISO — nothing is guessed at", () => {
  assert.equal(isoDate("2019-06-12"), "2019-06-12");
  assert.equal(isoDate("2026-03-01T21:46:24Z"), "2026-03-01");
  assert.equal(isoDate("06/12/2019"), null);
  assert.equal(isoDate("2019-02-30"), null);
  assert.equal(isoDate("2019-13-01"), null);
  assert.equal(isoDate(""), null);
  assert.equal(isoDate(null), null);
});

test("the last four digits are read off the identifier, or refused", () => {
  assert.equal(lastFour("5121080011112222"), "2222");
  assert.equal(lastFour("XXXX-XXXX-XXXX-1234"), "1234");
  assert.equal(lastFour("12"), null);
  assert.equal(lastFour(null), null);
});

// ── File-level context ────────────────────────────────────────────────────

test("the report's own side of the personal-information comparison is read", () => {
  const context = normalizeContext(crsPayload(), { asOf: AS_OF });
  assert.deepEqual(context.file.names.value, [{ first: "SAMPLE", middle: "Q", last: "TESTCASE" }]);
  assert.equal(context.file.dateOfBirth.value, "1970-01-01");
  assert.equal(context.file.addresses.value[0].isCurrent, true);
  assert.equal(context.file.addresses.value[0].city, "SPRINGFIELD");
  assert.equal(context.file.employments.value[0].name, "EXAMPLE EMPLOYER");
  assert.equal(context.asOf, AS_OF);
});

test("the consumer's own account of things is never invented from the report", () => {
  const context = normalizeContext(crsPayload(), { asOf: AS_OF });
  for (const key of ["legalName", "dateOfBirth", "knownAccountNumbers", "employers"]) {
    assert.ok(isNotVisible(context.consumer[key]), `consumer.${key} must not be filled from a credit report`);
  }
  for (const key of ["active", "investigationCompleted", "consumerDisagreesWithOutcome"]) {
    assert.ok(isNotVisible(context.dispute[key]));
  }
  for (const key of ["included", "discharged", "dismissed", "chapter"]) {
    assert.ok(isNotVisible(context.bankruptcy[key]));
  }
});

test("a file with no personal information is absent, not invisible", () => {
  const context = normalizeContext(crsPayload({ creditFiles: [{ creditFileDetail: { sourceType: "Equifax" } }] }), { asOf: AS_OF });
  assert.ok(isAbsent(context.file.names));
  assert.ok(isAbsent(context.file.dateOfBirth));
  assert.ok(isAbsent(context.inquiries));
});

test("inquiries are read, but whether they are hard is not", () => {
  const context = normalizeContext(
    crsPayload({
      inquiries: [
        { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
        { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
      ]
    }),
    { asOf: AS_OF }
  );
  assert.equal(context.inquiries.value.length, 2);
  assert.equal(context.inquiries.value[0].bureau, "EQ");
  assert.equal(context.inquiries.value[0].inquiryDate, "2024-05-09");
  for (const inquiry of context.inquiries.value) {
    assert.ok(isNotVisible(inquiry.hard), "hard vs soft is not in the payload");
    assert.ok(isNotVisible(inquiry.consumerRecognizes));
  }
});

test("a duplicate inquiry on a real payload shape is still found, because that rule needs no intake data", () => {
  const payload = crsPayload({
    inquiries: [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
    ]
  });
  const { tradelines, context } = normalizeFromCrs(payload, { asOf: AS_OF });
  const result = runReport(tradelines, context);
  assert.equal(result.violations.filter((v) => v.ruleId === "M2-036").length, 1);
});

// ── Bureau peers ──────────────────────────────────────────────────────────

test("the same account from two bureaus is paired on creditor and last four", () => {
  const paired = attachBureauPeers([
    normalizeTradeline(crsTradeline({ sourceType: "Equifax" })),
    normalizeTradeline(crsTradeline({ sourceType: "TransUnion", accountOpenedDate: "2019-06-12" }))
  ]);
  assert.equal(paired[0].peers.length, 1);
  assert.equal(paired[0].peers[0].bureau.value, "TU");
});

test("two different cards from the same bank are not treated as the same account", () => {
  // Pairing on creditor alone would manufacture a Date Opened disagreement out of
  // two real, correctly reported accounts.
  const paired = attachBureauPeers([
    normalizeTradeline(crsTradeline({ accountIdentifier: "5121080011112222" })),
    normalizeTradeline(crsTradeline({ accountIdentifier: "5121080033334444", sourceType: "TransUnion" }))
  ]);
  assert.deepEqual(paired[0].peers, []);
  assert.deepEqual(paired[1].peers, []);
});

// ── End to end ────────────────────────────────────────────────────────────

test("a clean CRS payload run through the whole engine produces no violations", () => {
  // The strongest statement in this file. Real-shaped soft-pull data, every
  // check in the engine, nothing found — because the fields the checks need are
  // honestly marked invisible rather than reconstructed.
  const { tradelines, context } = normalizeFromCrs(crsPayload(), { asOf: AS_OF });
  const result = runReport(tradelines, context);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.errors, []);
});

test("adding intake facts wakes the rules that need them, without touching the rest", () => {
  const { tradelines, context } = normalizeFromCrs(crsPayload(), {
    asOf: AS_OF,
    consumerContext: {
      consumer: {
        legalName: { value: { first: "SAMPLE", last: "DIFFERENT" }, provenance: "observed" },
        dateOfBirth: { value: "1970-01-01", provenance: "observed" },
        knownAccountNumbers: { value: ["2222"], provenance: "observed" },
        employers: { value: ["EXAMPLE EMPLOYER"], provenance: "observed" }
      }
    }
  });
  const result = runReport(tradelines, context);
  const ids = result.violations.map((v) => v.ruleId);
  assert.deepEqual(ids, ["M2-032"], "only the name rule should have anything to say");
});

test("the intake merge does not let a caller overwrite a field the report actually showed", () => {
  const { context } = normalizeFromCrs(crsPayload(), {
    asOf: AS_OF,
    consumerContext: { consumer: { legalName: { value: { first: "SAMPLE", last: "TESTCASE" }, provenance: "observed" } } }
  });
  assert.equal(context.file.names.value[0].last, "TESTCASE", "the bureau's side stays the bureau's");
  assert.equal(context.consumer.legalName.value.last, "TESTCASE");
});

test("a payload wrapped in an envelope is still found", () => {
  assert.equal(extractTradelineRecords({ result: crsPayload() }).length, 1);
  assert.equal(extractTradelineRecords({ data: crsPayload() }).length, 1);
  assert.equal(extractTradelineRecords(crsPayload()).length, 1);
  assert.deepEqual(extractTradelineRecords(null), []);
  assert.deepEqual(extractTradelineRecords({}), []);
});

test("an empty payload normalizes to nothing without throwing", () => {
  const result = normalizeFromCrs({}, { asOf: AS_OF });
  assert.deepEqual(result.tradelines, []);
  assert.equal(result.asOf, AS_OF);
  assert.ok(isAbsent(result.context.inquiries) || isNotVisible(result.context.inquiries));
});

// ── The coverage report ───────────────────────────────────────────────────

test("coverage counts each field across the payload", () => {
  const coverage = crsFieldCoverage(crsPayload({ tradelines: [crsTradeline(), crsTradeline({ chargeOffAmount: "500" })] }));
  assert.equal(coverage.tradelineCount, 2);
  assert.equal(coverage.fields.field_21_current_balance.counts.observed, 2);
  assert.equal(coverage.fields.field_23_original_chargeoff_amount.counts.observed, 1);
  assert.equal(coverage.fields.field_23_original_chargeoff_amount.counts.absent, 1);
  assert.equal(coverage.fields.field_17A_account_status.alwaysNotVisible, true);
  assert.equal(coverage.fields.field_25_dofd.alwaysNotVisible, true);
});

test("what the normalizer promises and what it delivers are the same thing", () => {
  const coverage = crsFieldCoverage(crsPayload());
  for (const name of COVERED_FIELDS) {
    const field = coverage.fields[name];
    assert.equal(field.counts.malformed, 0, `${name} came out malformed`);
    if (field.declaredVisible) {
      assert.equal(field.counts.not_visible, 0, `${name} is declared readable but came out invisible`);
    } else {
      assert.equal(field.counts.observed, 0, `${name} is declared invisible but came out with a value`);
      assert.ok(field.reason, `${name} is invisible with no reason recorded`);
    }
  }
});

test("readiness names the rules a soft pull can never fire, and the field that silences each", () => {
  const readiness = ruleReadiness(crsPayload());
  assert.equal(readiness.liveCount + readiness.inertCount, 38);
  const inert = new Set(readiness.inert.map((r) => r.ruleId));
  // Everything that reads Field 17A, 17B, 18, 19, 20, 25, 38, K1, K2, or the
  // collector and medical flags.
  for (const ruleId of [
    "M2-004", "M2-006", "M2-007", "M2-009", "M2-010", "M2-011", "M2-012", "M2-013", "M2-014", "M2-015",
    "M2-016", "M2-017", "M2-018", "M2-019", "M2-020", "M2-022", "M2-023", "M2-024", "M2-025", "M2-026",
    "M2-027", "M2-028", "M2-029", "M2-030", "M2-035", "M2-038"
  ]) {
    assert.ok(inert.has(ruleId), `${ruleId} should be inert on soft-pull data`);
  }
  const live = new Set(readiness.live.map((r) => r.ruleId));
  for (const ruleId of ["M2-001", "M2-002", "M2-003", "M2-005", "M2-008", "M2-021", "M2-031", "M2-032", "M2-033", "M2-034", "M2-036", "M2-037"]) {
    assert.ok(live.has(ruleId), `${ruleId} should be able to fire on soft-pull data`);
  }
  assert.equal(readiness.liveCount, 12);
  for (const entry of readiness.inert) {
    assert.ok(entry.missing.length > 0, `${entry.ruleId} is listed inert with nothing missing`);
  }
});

test("the rule-input table stays in step with the engine's registry", () => {
  // Without this, adding a rule and forgetting the table would quietly report
  // the new rule as ready on a data source that cannot feed it.
  assert.deepEqual([...Object.keys(RULE_INPUTS)].sort(), [...implementedRuleIds()].sort());
});

test("every input named in the rule table is a field the normalizer emits or a context path", () => {
  const known = new Set([...COVERED_FIELDS, "context.file.addresses", "context.file.names", "context.file.dateOfBirth", "context.file.employments", "context.inquiries", "context.inquiries.hard"]);
  for (const [ruleId, inputs] of Object.entries(RULE_INPUTS)) {
    for (const input of inputs) assert.ok(known.has(input), `${ruleId} names an unknown input: ${input}`);
  }
});

test("context coverage reports the personal-information side as readable and the inquiry type as not", () => {
  const cov = contextCoverage(crsPayload({ inquiries: [{ creditorName: "X", inquiryDate: "2025-01-01", sourceType: "Equifax" }] }), { asOf: AS_OF });
  assert.equal(cov.file.names, "observed");
  assert.equal(cov.file.dateOfBirth, "observed");
  assert.equal(cov.file.addresses, "observed");
  assert.equal(cov.file.employments, "observed");
  assert.equal(cov.inquiries, "observed");
  assert.equal(cov.inquiryCount, 1);
  assert.equal(cov.inquiryTypeKnown, false);
  assert.equal(cov.consumerAssertionsPresent, false);
});

test("no invisible field is described as readable, and every visible one names its source", () => {
  for (const [name, entry] of Object.entries(FIELD_SOURCES)) {
    if (entry.visible) {
      assert.ok(entry.source, `${name} is readable but names no vendor field`);
      assert.equal(entry.reason, undefined, `${name} is readable and should not carry a reason`);
    } else {
      assert.ok(entry.reason && entry.reason.length > 40, `${name} needs a real reason, not a label`);
    }
  }
});

test("the status-code table is loaded and unused by the normalizer, which is the point", () => {
  // Field 17A has 24 codes to choose from. The normalizer chooses none of them.
  assert.ok(Object.keys(STATUS_CODES).length >= 20);
  const t = normalizeTradeline(crsTradeline());
  assert.equal(t.field_17A_account_status.value, null);
});
