// Fixtures for the violation engine.
//
// Two builders and a set of named cases. The builders exist because the honest
// default for a Metro 2 field is `not_visible` — most fields are invisible on
// most report formats — and a fixture that started from "everything observed"
// would quietly test a world that does not exist.
//
//   cleanTradeline(overrides)  every field observed, everything compliant.
//                              A negative fixture: no rule may fire on it.
//   blindTradeline(overrides)  every field not_visible. NO rule may fire on it,
//                              ever, for any reason. This is the fixture that
//                              proves the engine does not invent violations out
//                              of missing data.
//
// The dates are fixed strings. Nothing here reads the clock, so a test that
// passes today passes in a year.

import { observed, absent, notVisible } from "../../provenance.mjs";

/** The report date every fixture is evaluated against. */
export const AS_OF = "2026-08-07";

/** Every Metro 2 field the engine reads, in the knowledge base's field order. */
export const METRO2_FIELD_NAMES = Object.freeze([
  "account_number_last4",
  "portfolio_type",
  "account_type",
  "date_opened",
  "field_17A_account_status",
  "field_17B_payment_rating",
  "field_18_payment_history",
  "field_19_special_comment",
  "field_20_compliance_condition",
  "field_21_current_balance",
  "field_22_amount_past_due",
  "field_23_original_chargeoff_amount",
  "field_24_date_of_account_info",
  "field_25_dofd",
  "field_26_date_closed",
  "field_27_date_last_payment",
  "field_37_ecoa",
  "field_38_cii",
  "k1_original_creditor",
  "k2_purchased_from",
  "k2_sold_to",
  "furnisher_is_third_party_collector",
  "is_medical_debt"
]);

/**
 * A tradeline with nothing wrong with it. Status 11, current, nothing past due,
 * a clean 24-month history, a Date of Account Information inside the 30-day
 * window. No rule may fire on this.
 */
export function cleanTradeline(overrides = {}) {
  return {
    creditor: observed("CITIBANK SD NA"),
    bureau: observed("EQ"),
    account_number_last4: observed("4521"),
    portfolio_type: observed("R"),
    account_type: observed("18"),
    date_opened: observed("2019-03-15"),
    field_17A_account_status: observed("11"),
    field_17B_payment_rating: absent(),
    field_18_payment_history: observed("000000000000000000000000"),
    field_19_special_comment: absent(),
    field_20_compliance_condition: absent(),
    field_21_current_balance: observed(120000),
    field_22_amount_past_due: observed(0),
    field_23_original_chargeoff_amount: absent(),
    field_24_date_of_account_info: observed("2026-08-01"),
    field_25_dofd: absent(),
    field_26_date_closed: absent(),
    field_27_date_last_payment: observed("2026-07-20"),
    field_37_ecoa: observed("1"),
    field_38_cii: absent(),
    k1_original_creditor: absent(),
    k2_purchased_from: absent(),
    k2_sold_to: absent(),
    furnisher_is_third_party_collector: observed(false),
    is_medical_debt: observed(false),
    ...overrides
  };
}

/**
 * A tradeline whose every field is invisible — the shape a report format that
 * carries no Metro 2 codes produces. Nothing may ever fire on this.
 */
export function blindTradeline(overrides = {}) {
  const base = { creditor: notVisible(), bureau: notVisible() };
  for (const name of METRO2_FIELD_NAMES) base[name] = notVisible();
  return { ...base, ...overrides };
}

/** A context with nothing asserted — no consumer statements, no case history. */
export function bareContext(overrides = {}) {
  return { asOf: AS_OF, ...overrides };
}

/**
 * A context with every consumer assertion present and agreeing with
 * cleanTradeline(). A negative fixture for the checks that need an external
 * truth: they can see everything, and nothing is wrong.
 */
export function cleanContext(overrides = {}) {
  return {
    asOf: AS_OF,
    consumer: {
      legalName: observed({ first: "BARBARA", middle: "M", last: "DOTY" }),
      dateOfBirth: observed("1966-01-04"),
      knownAccountNumbers: observed(["4521"]),
      employers: observed([{ name: "DATAWORKS" }])
    },
    file: {
      names: observed([{ first: "BARBARA", middle: "M", last: "DOTY" }]),
      dateOfBirth: observed("1966-01-04"),
      addresses: observed([
        { line1: "1100 LYNHURST LN", city: "DENTON", state: "TX", postal: "76205", isCurrent: true, reportedOn: "2026-08-01" }
      ]),
      employments: observed([{ name: "DATAWORKS", reportedOn: "2026-01-10" }])
    },
    inquiries: observed([
      {
        creditor: "CITIBANK SD NA",
        inquiryDate: "2026-04-10",
        bureau: "EQ",
        hard: observed(true),
        consumerAuthorized: observed(true),
        consumerRecognizes: observed(true)
      }
    ]),
    reportedCreditors: observed(["CITIBANK SD NA"]),
    bureauPeers: [],
    relatedTradelines: observed([]),
    priorStatusReports: observed([]),
    dispute: {
      active: observed(false),
      investigationCompleted: observed(false),
      consumerDisagreesWithOutcome: observed(false)
    },
    bankruptcy: {
      included: observed(false),
      discharged: observed(false),
      dismissed: observed(false),
      chapter: absent()
    },
    expected: {
      portfolioType: observed("R"),
      accountType: observed("18"),
      ecoa: observed("1")
    },
    saleIndicated: observed(false),
    ...overrides
  };
}

/** A context in which every consumer-supplied fact is invisible. */
export function blindContext(overrides = {}) {
  return {
    asOf: AS_OF,
    consumer: {
      legalName: notVisible(),
      dateOfBirth: notVisible(),
      knownAccountNumbers: notVisible(),
      employers: notVisible()
    },
    file: {
      names: notVisible(),
      dateOfBirth: notVisible(),
      addresses: notVisible(),
      employments: notVisible()
    },
    inquiries: notVisible(),
    reportedCreditors: notVisible(),
    bureauPeers: [],
    relatedTradelines: notVisible(),
    priorStatusReports: notVisible(),
    dispute: {
      active: notVisible(),
      investigationCompleted: notVisible(),
      consumerDisagreesWithOutcome: notVisible()
    },
    bankruptcy: {
      included: notVisible(),
      discharged: notVisible(),
      dismissed: notVisible(),
      chapter: notVisible()
    },
    expected: { portfolioType: notVisible(), accountType: notVisible(), ecoa: notVisible() },
    saleIndicated: notVisible(),
    ...overrides
  };
}

/**
 * The Midland Funding collection from the knowledge base's own AI Prompt
 * Integration Guide, in this engine's shape. Kept because it is the worked
 * example the document itself uses, and it should trip several rules at once:
 * a collection with no K1, no DOFD and no compliance code.
 */
export function kbExampleCollection(overrides = {}) {
  return cleanTradeline({
    creditor: observed("Midland Funding"),
    account_number_last4: observed("4521"),
    portfolio_type: observed("O"),
    account_type: observed("48"),
    date_opened: observed("2019-03-15"),
    field_17A_account_status: observed("93"),
    field_17B_payment_rating: observed("G"),
    field_18_payment_history: observed("GGGGGGGGGGGGGGGGGGGGGGGG"),
    field_19_special_comment: absent(),
    field_20_compliance_condition: absent(),
    field_21_current_balance: observed(210000),
    field_22_amount_past_due: observed(210000),
    field_24_date_of_account_info: observed("2026-08-01"),
    field_25_dofd: absent(),
    field_37_ecoa: observed("1"),
    field_38_cii: absent(),
    k1_original_creditor: absent(),
    k2_purchased_from: absent(),
    furnisher_is_third_party_collector: observed(true),
    is_medical_debt: observed(false),
    ...overrides
  });
}

export { observed, absent, notVisible };
