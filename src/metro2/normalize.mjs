// CRS soft-pull payload → Metro 2 field shape, with provenance on every field.
//
// ══════════════════════════════════════════════════════════════════════════
// THIS IS THE MOST LIKELY PLACE IN THE SYSTEM TO PRODUCE A BAD LETTER.
//
// A consumer report is not a Metro 2 file. It is what a bureau chose to show a
// third party, and most Metro 2 code fields are not in it. The temptation is to
// reconstruct them from the prose the bureau does send — to read
// `currentRatingType: "ChargeOff"` and write Field 17A = 97, or to read
// `accountStatusType: "Paid"` and write Field 17A = 13.
//
// This module refuses to do that, and the refusal is the point. Fifteen of the
// thirty-eight checks read Field 17A. A mapping that is right nine times in ten
// would put a wrong claim about a real consumer's account into a mailed letter
// roughly once per client — and a letter citing a Metro 2 defect that is an
// artefact of our own guess is worse than no letter. It is the evidence a
// furnisher needs to call the dispute frivolous under 12 CFR 1022.43 and ignore
// it without investigating.
//
// So a field is `observed` or `absent` ONLY where the payload carries the actual
// Metro 2 value or where a translation is deterministic and one-to-one on the
// vendor's own enumeration names. Everything else is `not_visible`, and the
// rules that read it stay silent.
//
// ── THE THREE TRANSLATIONS THAT ARE PERMITTED, AND WHY ────────────────────
//
// 1. Portfolio Type (Field 8) ← `accountType`.
//    Metro 2 Field 8 is C/I/M/O/R (§ 1.3). The vendor's `accountType`
//    enumeration is Revolving / Installment / Mortgage / Open / Unknown. Four of
//    those are the same four categories under their own names, so the mapping is
//    a rename, not an inference. `Unknown` maps to nothing and stays invisible.
//    Metro 2's "C" (Line of Credit) has no `accountType` counterpart and is
//    therefore never produced.
//
// 2. ECOA Code (Field 37) ← `accountOwnershipType`.
//    Exhibit 10's names and the vendor's names coincide exactly for six values:
//    Individual/1, JointContractualLiability/2, AuthorizedUser/3, Comaker/5,
//    Maker/7, Terminated/T. The remaining vendor values are refused, and the
//    refusals matter more than the matches — `JointParticipating` describes a
//    joint account WITHOUT contractual liability, which Exhibit 10 has no code
//    for, and a bare `Joint` does not say which kind it is. Mapping either to
//    ECOA 2 would assert the consumer is contractually liable for a debt on the
//    strength of an ambiguous label.
//
// 3. Bureau ← `sourceType`. TransUnion/TU, Experian/EX, Equifax/EQ. A rename.
//
// Everything else stated as invisible is listed with its evidence in
// docs/metro2/CRS-FIELD-COVERAGE.md.
//
// PURE. No clock, no network, no database. `asOf` is passed in.

import { observed, absent, notVisible, fromRaw, isObserved } from "./provenance.mjs";
import { KB_STAMP } from "./version.mjs";

/**
 * Dollars (a number, or a string as the vendor sends it) → integer cents.
 * Returns null for anything unreadable.
 *
 * A LOCAL CONVERTER, DELIBERATELY. Two exist already and neither is right here:
 *   * src/commissions/money.mjs `toCents("")` returns 0, which would turn an
 *     unreported balance into "$0.00 owed" — and a $0 balance is exactly the
 *     value that trips M2-012 and satisfies M2-011. An unknown must stay
 *     unknown all the way through.
 *   * src/tradelines/index.mjs has the right null semantics but belongs to the
 *     funding normalizer, which the owner decided stays separate from this one.
 *     Importing it would mean a change made for the funding calculator silently
 *     moves the dollar figures printed in dispute letters.
 */
export function dollarsToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number") {
    /* Strip the currency dressing first, then insist something is left. Without
       the emptiness check, Number("") is 0 and a whitespace-only balance would
       come out as a reported $0.00 — the one wrong answer that trips M2-012. */
    const cleaned = String(value).replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  const n = value;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Strict YYYY-MM-DD passthrough. A date that is not already ISO is refused. */
export function isoDate(value) {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = m[1];
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** Translation 1 — vendor `accountType` → Metro 2 Field 8 Portfolio Type. */
export const PORTFOLIO_TYPE_FROM_ACCOUNT_TYPE = Object.freeze({
  Revolving: "R",
  Installment: "I",
  Mortgage: "M",
  Open: "O"
});

/** Translation 2 — vendor `accountOwnershipType` → Metro 2 Field 37 ECOA. */
export const ECOA_FROM_OWNERSHIP_TYPE = Object.freeze({
  Individual: "1",
  JointContractualLiability: "2",
  AuthorizedUser: "3",
  Comaker: "5",
  Maker: "7",
  Terminated: "T"
});

/**
 * Vendor ownership values that are deliberately NOT translated, with the reason.
 * Kept as data so the refusals are as visible as the mappings and so a future
 * edition of this file cannot quietly add one of them.
 */
export const ECOA_REFUSED_OWNERSHIP_TYPES = Object.freeze({
  Joint: "does not say whether liability is contractual (ECOA 2) or participating (no ECOA code)",
  JointParticipating: "joint without contractual liability — Exhibit 10 has no code for it",
  Undesignated: "the vendor is stating it does not know",
  Comaker7: "not a vendor value; guard against a typo'd key"
});

/** Translation 3 — vendor `sourceType` → the bureau abbreviation. */
export const BUREAU_FROM_SOURCE_TYPE = Object.freeze({
  TransUnion: "TU",
  Experian: "EX",
  Equifax: "EQ"
});

/**
 * Every field the normalizer emits, and where it comes from.
 *
 * `source` is the vendor key when the field is readable. `reason` is why the
 * field cannot be read when it is not. This table is the machine form of
 * docs/metro2/CRS-FIELD-COVERAGE.md, and crs-field-coverage.mjs reports against
 * it — so a field silently changing status shows up as a coverage change.
 */
export const FIELD_SOURCES = Object.freeze({
  creditor: { field: "—", source: "creditorName", visible: true },
  bureau: { field: "—", source: "sourceType", visible: true },
  account_number_last4: { field: "7", source: "accountIdentifier", visible: true },
  portfolio_type: { field: "8", source: "accountType (translated)", visible: true },
  account_type: {
    field: "9",
    visible: false,
    reason:
      "Field 9 is a two-digit industry code from Exhibit 1. The knowledge base references Exhibit 1 " +
      "but does not reproduce it, so there is no code table in this repo to map the vendor's prose " +
      "`loanType` onto."
  },
  date_opened: { field: "10", source: "accountOpenedDate", visible: true },
  field_17A_account_status: {
    field: "17A",
    visible: false,
    reason:
      "The payload carries `accountStatusType` (Open/Closed/Paid/Transferred) and `currentRatingType` " +
      "(AsAgreed/Late60Days/ChargeOff/BankruptcyOrWageEarnerPlan/TooNew/NoDataAvailable). Neither is " +
      "an Exhibit 4 code, and reconstructing one would require inferring across two fields. Fifteen " +
      "of the thirty-eight checks read this field, so a wrong reconstruction would be wrong fifteen " +
      "times over on one tradeline."
  },
  field_17B_payment_rating: {
    field: "17B",
    visible: false,
    reason:
      "`currentRatingCode` uses C / N / - / 1–9. Field 17B is 0–6 / G / L. The alphabets do not " +
      "overlap, so there is nothing to map."
  },
  field_18_payment_history: {
    field: "18",
    visible: false,
    reason:
      "`paymentPatternData` uses C and X and digits, and runs 1 to 35 characters. Field 18 is exactly " +
      "24 characters from 0–6 / B / D / E / G / H / J / K / L."
  },
  field_19_special_comment: {
    field: "19",
    visible: false,
    reason:
      "`comments[].commentCode` carries bureau narrative codes, not Exhibit 7 codes. The sandbox " +
      "proves it: commentCode AV reads \"CHARGE\", while Exhibit 7's AV is \"First payment never " +
      "received\". Treating one alphabet as the other would invent a contradiction on every account " +
      "carrying a comment."
  },
  field_20_compliance_condition: {
    field: "20",
    visible: false,
    reason:
      "No dispute or closure flag appears on a consumer tradeline in this payload. " +
      "`customerDisputeIndicator` exists only in the commercial business reports."
  },
  field_21_current_balance: { field: "21", source: "currentBalanceAmount", visible: true },
  field_22_amount_past_due: { field: "22", source: "pastDueAmount", visible: true },
  field_23_original_chargeoff_amount: { field: "23", source: "chargeOffAmount", visible: true },
  field_24_date_of_account_info: { field: "24", source: "accountReportedDate", visible: true },
  field_25_dofd: {
    field: "25",
    visible: false,
    reason:
      "No Date of First Delinquency in the payload. `adverseRatings.priorAdverseRatings` and the " +
      "\"Late Dates:\" comment text carry dated delinquencies, and the earliest of those is NOT the " +
      "DOFD — it is the earliest delinquency still inside the reporting window. Deriving one from the " +
      "other would re-age the account by our own hand, in the same direction a furnisher would."
  },
  field_26_date_closed: { field: "26", source: "accountClosedDate", visible: true },
  field_27_date_last_payment: {
    field: "27",
    visible: false,
    reason:
      "No field means \"date of last payment\". `lastActivityDate` is activity of any kind and " +
      "`accountPaidDate` is the date an account was settled — neither is the most recent payment."
  },
  field_37_ecoa: { field: "37", source: "accountOwnershipType (translated, partial)", visible: true },
  field_38_cii: {
    field: "38",
    visible: false,
    reason:
      "No Consumer Information Indicator. Bankruptcy appears only as prose — " +
      "`currentRatingType: \"BankruptcyOrWageEarnerPlan\"` and comment text \"BANKRUPTCY DISCHARGED\" " +
      "— which does not distinguish a petition (CII A–D) from a discharge (CII E–H). That distinction " +
      "is the whole of M2-025."
  },
  k1_original_creditor: {
    field: "K1",
    visible: false,
    reason:
      "No original-creditor field. `creditorName` is the furnisher reporting the tradeline, which on " +
      "a collection is the collector — the opposite of what K1 records."
  },
  k2_purchased_from: {
    field: "K2",
    visible: false,
    reason: "No purchased-from field. Comment text \"ACCOUNT TRANSFERRED OR SOLD\" names no counterparty."
  },
  k2_sold_to: {
    field: "K2",
    visible: false,
    reason: "No sold-to field, for the same reason as k2_purchased_from."
  },
  furnisher_is_third_party_collector: {
    field: "—",
    visible: false,
    reason:
      "Not a Metro 2 base-segment field. The answer lives in Field 9's Exhibit 1 industry code, which " +
      "this repo does not have. `businessType` is a broad category (Banking, Finance, Miscellaneous) " +
      "that does not separate a collector from a lender. Inferring it from a creditor's name would be " +
      "a guess about a specific company."
  },
  is_medical_debt: {
    field: "—",
    visible: false,
    reason:
      "Same as above: an Exhibit 1 industry code. A comment reading \"MEDICAL\" appears on some " +
      "tradelines but is a bureau narrative, not a classification the whole file uses consistently."
  }
});

/** The vendor keys that hold the tradeline list, and the envelopes it may sit inside. */
const TRADELINE_KEYS = ["tradelines"];
const ENVELOPE_KEYS = ["result", "data", "report"];

function unwrap(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (TRADELINE_KEYS.some((k) => Array.isArray(payload[k]))) return payload;
  for (const key of ENVELOPE_KEYS) {
    const inner = payload[key];
    if (inner && typeof inner === "object" && TRADELINE_KEYS.some((k) => Array.isArray(inner[k]))) return inner;
  }
  return payload;
}

/** The tradeline records in a payload, or []. */
export function extractTradelineRecords(payload) {
  const root = unwrap(payload);
  for (const key of TRADELINE_KEYS) {
    if (Array.isArray(root?.[key])) return root[key];
  }
  return [];
}

/** Last four digits of an account identifier, or null when there are not four. */
export function lastFour(identifier) {
  const digits = String(identifier ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * One CRS tradeline record → one Metro 2-shaped tradeline, every field wrapped.
 *
 * Returns null for a record with no creditor and no account identifier, which is
 * not a tradeline in any useful sense.
 */
export function normalizeTradeline(record) {
  if (!record || typeof record !== "object") return null;
  const creditorName = record.creditorName ?? null;
  const identifier = record.accountIdentifier ?? null;
  if (creditorName == null && identifier == null) return null;

  const portfolio = PORTFOLIO_TYPE_FROM_ACCOUNT_TYPE[record.accountType];
  const ecoa = ECOA_FROM_OWNERSHIP_TYPE[record.accountOwnershipType];
  const bureau = BUREAU_FROM_SOURCE_TYPE[record.sourceType];

  const money = (value) => {
    const cents = dollarsToCents(value);
    return cents === null ? absent() : observed(cents);
  };
  const date = (value) => {
    const iso = isoDate(value);
    return iso === null ? absent() : observed(iso);
  };

  return {
    // Identity
    creditor: fromRaw(creditorName),
    bureau: bureau ? observed(bureau) : notVisible(),
    bureau_reporting: bureau ? observed([bureau]) : notVisible(),
    account_number_last4: (() => {
      const four = lastFour(identifier);
      return four === null ? absent() : observed(four);
    })(),

    // Fields the payload carries
    portfolio_type: portfolio ? observed(portfolio) : notVisible(),
    date_opened: date(record.accountOpenedDate),
    field_21_current_balance: money(record.currentBalanceAmount),
    field_22_amount_past_due: money(record.pastDueAmount),
    field_23_original_chargeoff_amount: money(record.chargeOffAmount),
    field_24_date_of_account_info: date(record.accountReportedDate),
    field_26_date_closed: date(record.accountClosedDate),
    field_37_ecoa: ecoa ? observed(ecoa) : notVisible(),

    // Fields no consumer soft pull exposes. See FIELD_SOURCES for the evidence
    // behind each one, and docs/metro2/CRS-FIELD-COVERAGE.md for the write-up.
    account_type: notVisible(),
    field_17A_account_status: notVisible(),
    field_17B_payment_rating: notVisible(),
    field_18_payment_history: notVisible(),
    field_19_special_comment: notVisible(),
    field_20_compliance_condition: notVisible(),
    field_25_dofd: notVisible(),
    field_27_date_last_payment: notVisible(),
    field_38_cii: notVisible(),
    k1_original_creditor: notVisible(),
    k2_purchased_from: notVisible(),
    k2_sold_to: notVisible(),
    furnisher_is_third_party_collector: notVisible(),
    is_medical_debt: notVisible(),

    /* The untouched source record. Kept so a disputed reading can be traced back
       to exactly what the vendor sent, without re-pulling the report. */
    raw: record
  };
}

/**
 * The file-level context the report checks need, built from the same payload.
 *
 * Consumer-side assertions (legal name, date of birth, current employers,
 * whether an inquiry was authorised) are NOT here — they come from intake, not
 * from the credit report, and are merged in by the caller. Everything this
 * function can supply is the bureau's side of the comparison.
 */
export function normalizeContext(payload, { asOf = null } = {}) {
  const root = unwrap(payload) ?? {};
  const files = Array.isArray(root.creditFiles) ? root.creditFiles : [];
  const inquiryRecords = Array.isArray(root.inquiries) ? root.inquiries : [];
  const tradelineRecords = extractTradelineRecords(root);

  const names = files.flatMap((f) =>
    (Array.isArray(f?.aliases) ? f.aliases : []).map((a) => ({
      first: a?.firstName ?? null,
      middle: a?.middleName ?? null,
      last: a?.lastName ?? null
    }))
  );

  const dob = files
    .flatMap((f) => (Array.isArray(f?.dobs) ? f.dobs : []))
    .map((d) => isoDate(d?.dob))
    .find((d) => d !== null);

  const addresses = files.flatMap((f) =>
    (Array.isArray(f?.addresses) ? f.addresses : []).map((a) => ({
      line1: a?.addressLine1 ?? null,
      line2: a?.addressLine2 ?? null,
      city: a?.city ?? null,
      state: a?.state ?? null,
      postal: a?.postalCode ?? null,
      // `borrowerResidencyType` is the vendor's own current/former marker.
      isCurrent: a?.borrowerResidencyType === "Current",
      reportedOn: isoDate(a?.dateReported)
    }))
  );

  const employments = files.flatMap((f) =>
    (Array.isArray(f?.employments) ? f.employments : []).map((e) => ({
      name: e?.employerName ?? null,
      reportedOn: isoDate(e?.employmentReportedDate)
    }))
  );

  const inquiries = inquiryRecords.map((i) => ({
    creditor: i?.creditorName ?? null,
    inquiryDate: isoDate(i?.inquiryDate),
    bureau: BUREAU_FROM_SOURCE_TYPE[i?.sourceType] ?? null,
    businessType: i?.businessType ?? null,
    /* HARD OR SOFT IS NOT IN THE PAYLOAD. There is no inquiry-type field on a
       consumer inquiry record. Marking these `hard` because a bureau usually
       only discloses hard inquiries to a third party would be an assumption
       about the vendor's behaviour, and M2-035 and M2-038 both turn on it — so
       it stays invisible and the caller supplies it if they can confirm it.
       Logged as an OPEN item in docs/metro2/CRS-FIELD-COVERAGE.md. */
    hard: notVisible(),
    consumerAuthorized: notVisible(),
    consumerRecognizes: notVisible(),
    raw: i
  }));

  const reportedCreditors = tradelineRecords.map((t) => t?.creditorName).filter((c) => c != null);

  return {
    asOf,
    kbVersion: KB_STAMP,
    file: {
      names: names.length > 0 ? observed(names) : absent(),
      dateOfBirth: dob ? observed(dob) : absent(),
      addresses: addresses.length > 0 ? observed(addresses) : absent(),
      employments: employments.length > 0 ? observed(employments) : absent()
    },
    inquiries: inquiries.length > 0 ? observed(inquiries) : absent(),
    reportedCreditors: observed(reportedCreditors),
    /* Nothing in a credit report tells us the consumer's own account of their
       name, employers or disputes, so these stay invisible until intake fills
       them in. `absent()` here would mean "the consumer told us nothing", which
       is a different and reportable claim. */
    consumer: {
      legalName: notVisible(),
      dateOfBirth: notVisible(),
      knownAccountNumbers: notVisible(),
      employers: notVisible()
    },
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
    priorStatusReports: notVisible(),
    saleIndicated: notVisible()
  };
}

/**
 * Bureau peers: the same account as reported by a different bureau.
 *
 * Matched on creditor plus the last four digits of the account number. Both must
 * be present — matching on creditor alone would pair two different Citibank
 * cards and manufacture a Date Opened disagreement out of two real accounts,
 * which is precisely the false claim M2-002 must not make.
 */
export function attachBureauPeers(tradelines = []) {
  const key = (t) => {
    const creditor = isObserved(t?.creditor) ? String(t.creditor.value).toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
    const four = isObserved(t?.account_number_last4) ? t.account_number_last4.value : null;
    return creditor && four ? `${creditor}|${four}` : null;
  };

  return tradelines.map((tradeline) => {
    const k = key(tradeline);
    const peers =
      k === null
        ? []
        : tradelines.filter((other) => other !== tradeline && key(other) === k && isObserved(other.bureau));
    return { ...tradeline, peers };
  });
}

/**
 * A whole CRS payload → everything the engine needs.
 *
 * `consumerContext` is merged over the derived context so intake-supplied facts
 * (legal name, date of birth, dispute history, bankruptcy) reach the rules that
 * need them without this module inventing any of them.
 */
export function normalizeFromCrs(payload, { asOf = null, consumerContext = {} } = {}) {
  const tradelines = extractTradelineRecords(payload).map(normalizeTradeline).filter(Boolean);
  const derived = normalizeContext(payload, { asOf });

  const withPeers = attachBureauPeers(tradelines);
  const tradelinesWithContext = withPeers.map(({ peers, ...tradeline }) => ({ tradeline, bureauPeers: peers }));

  return {
    asOf,
    kbVersion: KB_STAMP,
    tradelines,
    context: {
      ...derived,
      ...consumerContext,
      consumer: { ...derived.consumer, ...(consumerContext.consumer ?? {}) },
      file: { ...derived.file, ...(consumerContext.file ?? {}) },
      dispute: { ...derived.dispute, ...(consumerContext.dispute ?? {}) },
      bankruptcy: { ...derived.bankruptcy, ...(consumerContext.bankruptcy ?? {}) },
      expected: { ...derived.expected, ...(consumerContext.expected ?? {}) }
    },
    byTradeline: tradelinesWithContext
  };
}
