// § 5.1 — Universal checks, run on every tradeline. Rules M2-001 … M2-010.
//
// Every function here is pure, takes (tradeline, context) and returns an array
// of violations — empty when nothing fired. An array rather than a single
// object because several rules can find more than one defect in one pass
// (M2-006 can see a missing DOFD and a cross-bureau mismatch at once), and a
// uniform return type keeps the registry in index.mjs free of special cases.
//
// ── THE RULE EVERY FUNCTION OBEYS ─────────────────────────────────────────
//
// A check returns [] when it cannot see one of its inputs. It does not guess,
// and "cannot see" is never treated as "clean". Concretely, every rule opens by
// testing provenance, and a field marked `not_visible` ends the rule there.
//
// ── FOUR CHECKS NEED AN EXTERNAL TRUTH ────────────────────────────────────
//
// "Is the Account Number accurate?" cannot be answered from the credit report
// alone — the report is the thing under suspicion. M2-001, M2-003, M2-004 and
// M2-008 compare the report against what the consumer says is true, supplied on
// `context.consumer` and `context.expected`. With no consumer assertion these
// checks cannot fire, which is correct: absent the consumer's own account we
// have no basis to call the furnisher wrong.

import { isVisible, isObserved, isAbsent } from "../provenance.mjs";
import { violation, str, list, isTrue, sameText, normalizeText, opt } from "./violation.mjs";
import { addDays, addYears, compareIso, daysBetween } from "../dates.mjs";
import {
  STATUS_CODES,
  PORTFOLIO_TYPES,
  THIRD_PARTY_COLLECTOR_STATUSES,
  statusDef
} from "../rules/status-codes.mjs";
import { ALL_ECOA_CODES, OBSOLETE_ECOA_CODES, isObsoleteEcoaCode, ECOA_OBSOLETE_SINCE } from "../rules/ecoa-codes.mjs";
import { CII_CODES, CII_DISCHARGED_CODES, isCiiCode, CHAPTER_TO_DISCHARGED_CII } from "../rules/cii-codes.mjs";
import { COMPLIANCE_CODES, REQUIRE_DATE_CLOSED_CODES, isComplianceCode } from "../rules/compliance-codes.mjs";

/**
 * Is this tradeline a collection or a charge-off?
 *
 * Used by the DOFD rules, because § 1.6 scopes "missing DOFD is a violation" to
 * collections and charge-offs specifically. A current credit card has no first
 * delinquency, and firing there would be inventing a violation.
 *
 * Returns true, false, or null for "cannot tell" — and null must not read as
 * false, which is why callers test it explicitly.
 */
export function isDerogatoryAccount(tradeline) {
  if (isTrue(tradeline?.furnisher_is_third_party_collector)) return true;
  const status = str(tradeline?.field_17A_account_status);
  if (status === null) return isVisible(tradeline?.furnisher_is_third_party_collector) ? false : null;
  const def = statusDef(status);
  if (!def) return null;
  return def.showsDelinquency === true || THIRD_PARTY_COLLECTOR_STATUSES.includes(status);
}

/** Check 1 — Field 7. Does the account number match the consumer's records? */
export function checkAccountNumberAccuracy(tradeline, context) {
  const reported = str(tradeline?.account_number_last4);
  const known = list(context?.consumer?.knownAccountNumbers);
  if (reported === null || known === null) return [];

  // Compare on the trailing four digits: a consumer supplying a full account
  // number and a report showing only the last four are the same account.
  const tail = (v) => String(v).replace(/\D/g, "").slice(-4);
  const reportedTail = tail(reported);
  if (reportedTail.length < 4) return [];
  if (known.some((k) => tail(k) === reportedTail)) return [];

  return [
    violation({
      ruleId: "M2-001",
      field: "7",
      observed: reported,
      expected: known,
      reason:
        `Consumer Account Number ending ${reportedTail} does not match any account number the ` +
        `consumer holds with this creditor. An account number that does not identify a real account ` +
        `of the consumer's cannot be objectively verified.`
    })
  ];
}

/** Check 2 — Field 10. Is Date Opened consistent across bureaus? */
export function checkDateOpenedAcrossBureaus(tradeline, context) {
  const mine = str(tradeline?.date_opened);
  if (mine === null) return [];
  const peers = Array.isArray(context?.bureauPeers) ? context.bureauPeers : [];

  const disagreeing = peers
    .filter((p) => isObserved(p?.date_opened) && str(p.date_opened) !== mine)
    .map((p) => ({ bureau: str(p.bureau) ?? "other bureau", date_opened: str(p.date_opened) }));
  if (disagreeing.length === 0) return [];

  return [
    violation({
      ruleId: "M2-002",
      field: "10",
      observed: { bureau: str(tradeline?.bureau) ?? null, date_opened: mine, peers: disagreeing },
      expected: "one Date Opened, identical at every bureau reporting the account",
      reason:
        `Date Opened is reported as ${mine} here and as ` +
        `${disagreeing.map((d) => `${d.date_opened} at ${d.bureau}`).join(", ")}. ` +
        `An account has one opening date; the dates cannot all be accurate.`
    })
  ];
}

/** Check 3 — Field 8. Is the Portfolio Type correct? */
export function checkPortfolioType(tradeline, context) {
  const reported = str(tradeline?.portfolio_type);
  const expected = str(context?.expected?.portfolioType);
  if (reported === null || expected === null) return [];
  if (reported === expected) return [];

  return [
    violation({
      ruleId: "M2-003",
      field: "8",
      observed: reported,
      expected,
      reason:
        `Portfolio Type is reported as ${reported} ` +
        `(${PORTFOLIO_TYPES[reported] ?? "unrecognised code"}) when the account is ` +
        `${PORTFOLIO_TYPES[expected] ?? expected}. The wrong portfolio type misrepresents the ` +
        `nature of the account.`
    })
  ];
}

/** Check 4 — Field 9. Is the Account Type correct? */
export function checkAccountType(tradeline, context) {
  const reported = str(tradeline?.account_type);
  const expected = str(context?.expected?.accountType);
  if (reported === null || expected === null) return [];
  if (reported === expected) return [];

  return [
    violation({
      ruleId: "M2-004",
      field: "9",
      observed: reported,
      expected,
      reason:
        `Account Type is reported as industry code ${reported} when the correct code for this ` +
        `product is ${expected}. The wrong account type misrepresents what the account is.`
    })
  ];
}

/** Check 5 — Field 24. Is the Date of Account Information current? */
export function checkStaleAccountInformation(tradeline, context) {
  const doai = str(tradeline?.field_24_date_of_account_info);
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;
  if (doai === null || asOf === null) return [];

  const age = daysBetween(doai, asOf);
  const limit = opt(context, "staleDoaiDays");
  if (age === null || age <= limit) return [];

  return [
    violation({
      ruleId: "M2-005",
      field: "24",
      observed: doai,
      expected: `within ${limit} days of ${asOf}`,
      reason:
        `Date of Account Information is ${doai}, which is ${age} days before the report date ` +
        `${asOf}. A furnisher is required to update monthly; a stale as-of date means the balance ` +
        `and status shown may no longer describe the account.`
    })
  ];
}

/**
 * Check 6 — Field 25. Is the DOFD present and consistent?
 *
 * Three separate defects, deliberately reported separately because they carry
 * different weight (see severity.mjs): a missing DOFD makes the seven-year clock
 * unverifiable, a DOFD that disagrees across bureaus is re-aging evidence, and a
 * DOFD after the report date is impossible on its face.
 */
export function checkDofdPresentAndConsistent(tradeline, context) {
  const found = [];
  const dofd = tradeline?.field_25_dofd;
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;

  // (a) Missing, on an account where a first delinquency must exist.
  //     Scoped to collections and charge-offs per § 1.6 — a current account has
  //     no first delinquency, and firing there would invent a violation.
  if (isAbsent(dofd)) {
    const derogatory = isDerogatoryAccount(tradeline);
    if (derogatory === true) {
      found.push(
        violation({
          ruleId: "M2-006",
          subcase: "dofd_missing_on_derogatory",
          field: "25",
          observed: null,
          expected: "the month and year the delinquency that led to this action began",
          reason:
            `No Date of First Delinquency is reported on an account being reported as a collection ` +
            `or charge-off. Without it the seven-year reporting period has no starting point, so ` +
            `neither the consumer nor the bureau can verify that this account is still reportable.`
        })
      );
    }
  }

  const mine = str(dofd);
  if (mine === null) return found;

  // (b) Disagrees with another bureau — the signature of re-aging.
  const peers = (Array.isArray(context?.bureauPeers) ? context.bureauPeers : [])
    .filter((p) => isObserved(p?.field_25_dofd) && str(p.field_25_dofd) !== mine)
    .map((p) => ({ bureau: str(p.bureau) ?? "other bureau", dofd: str(p.field_25_dofd) }));
  if (peers.length > 0) {
    found.push(
      violation({
        ruleId: "M2-006",
        subcase: "dofd_mismatch_across_bureaus",
        field: "25",
        observed: { dofd: mine, peers },
        expected: "the same Date of First Delinquency at every bureau, matching the original creditor's",
        reason:
          `Date of First Delinquency is reported as ${mine} here and as ` +
          `${peers.map((p) => `${p.dofd} at ${p.bureau}`).join(", ")}. Once established the DOFD does ` +
          `not change, and a purchaser must report the same date as the original creditor. Moving it ` +
          `forward extends the reporting window.`
      })
    );
  }

  // (c) After the report date. A delinquency cannot begin in the future.
  if (asOf !== null && compareIso(mine, asOf) === 1) {
    found.push(
      violation({
        ruleId: "M2-006",
        subcase: "dofd_future",
        field: "25",
        observed: mine,
        expected: `a date no later than ${asOf}`,
        reason:
          `Date of First Delinquency is ${mine}, which is after the report date ${asOf}. A ` +
          `delinquency cannot have begun after the date the account was reported.`
      })
    );
  }

  return found;
}

/** Check 7 — Field 25. Has DOFD + 7 years + 180 days passed? */
export function checkSevenYearWindowExpired(tradeline, context) {
  const dofd = str(tradeline?.field_25_dofd);
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;
  if (dofd === null || asOf === null) return [];

  const extraDays = opt(context, "sevenYearDays");
  const deadline = addDays(addYears(dofd, 7), extraDays);
  if (deadline === null || compareIso(deadline, asOf) !== -1) return [];

  return [
    violation({
      ruleId: "M2-007",
      field: "25",
      observed: { dofd, obsoleteOn: deadline, asOf },
      expected: "the account removed from the file",
      reason:
        `The Date of First Delinquency is ${dofd}. Seven years and ${extraDays} days from that date ` +
        `was ${deadline}, which is before the report date ${asOf}. The reporting period for this ` +
        `account has expired and it may no longer appear in the file.`
    })
  ];
}

/** Check 8 — Field 37. Is the ECOA Code correct? */
export function checkEcoaCode(tradeline, context) {
  const found = [];
  const reported = str(tradeline?.field_37_ecoa);
  if (reported === null) return found;

  if (isObsoleteEcoaCode(reported)) {
    found.push(
      violation({
        ruleId: "M2-008",
        field: "37",
        observed: reported,
        expected: `a current ECOA code (${Object.keys(ALL_ECOA_CODES).filter((c) => !OBSOLETE_ECOA_CODES[c]).join(", ")})`,
        reason:
          `ECOA Code ${reported} has been obsolete since ${ECOA_OBSOLETE_SINCE.replace("-", "/")}. ` +
          `A code the format stopped accepting over twenty years ago cannot accurately describe the ` +
          `consumer's present relationship to this account.`
      })
    );
    return found;
  }

  if (!Object.hasOwn(ALL_ECOA_CODES, reported)) {
    found.push(
      violation({
        ruleId: "M2-008",
        field: "37",
        observed: reported,
        expected: Object.keys(ALL_ECOA_CODES).filter((c) => !OBSOLETE_ECOA_CODES[c]),
        reason:
          `ECOA Code ${reported} is not a code Exhibit 10 defines. A value outside the permitted set ` +
          `does not describe any recognised relationship to the account.`
      })
    );
    return found;
  }

  const expected = str(context?.expected?.ecoa);
  if (expected !== null && expected !== reported) {
    found.push(
      violation({
        ruleId: "M2-008",
        field: "37",
        observed: reported,
        expected,
        reason:
          `ECOA Code ${reported} (${ALL_ECOA_CODES[reported].meaning}) is reported, but the ` +
          `consumer's relationship to this account is ${expected} ` +
          `(${ALL_ECOA_CODES[expected]?.meaning ?? "as stated by the consumer"}). This misstates who ` +
          `is legally responsible for the debt.`
      })
    );
  }

  return found;
}

/**
 * Check 9 — Field 38. Is the Consumer Information Indicator appropriate?
 *
 * SCOPE, deliberately narrowed. § 5.1's trigger text for this check and
 * § 5.4's check 24 describe the same defect from two directions. To keep one
 * defect from producing two violations in one letter, the split is:
 *
 *   M2-009 (here)  a CII that IS reported and is wrong — an unrecognised code,
 *                  or a discharge asserted where no discharge happened, or a
 *                  chapter that contradicts the consumer's bankruptcy.
 *   M2-024         a CII that is MISSING after a discharge.
 *
 * Recorded in docs/metro2/README.md as a deliberate deviation from a literal
 * reading of § 5.1.
 */
export function checkConsumerInformationIndicator(tradeline, context) {
  const reported = str(tradeline?.field_38_cii);
  if (reported === null) return [];

  if (!isCiiCode(reported)) {
    return [
      violation({
        ruleId: "M2-009",
        field: "38",
        observed: reported,
        expected: Object.keys(CII_CODES),
        reason:
          `Consumer Information Indicator ${reported} is not a code Exhibit 11 defines. A bankruptcy ` +
          `flag outside the permitted set states nothing verifiable about the account.`
      })
    ];
  }

  const bk = context?.bankruptcy ?? {};

  // A discharge asserted where the consumer had no discharge.
  if (CII_DISCHARGED_CODES.includes(reported) && isObserved(bk.discharged) && bk.discharged.value === false) {
    return [
      violation({
        ruleId: "M2-009",
        field: "38",
        observed: reported,
        expected: "no discharge indicator, or the indicator matching the actual bankruptcy outcome",
        reason:
          `Consumer Information Indicator ${reported} (${CII_CODES[reported].meaning}) is reported, ` +
          `but no bankruptcy discharge applies to this account. Reporting a discharge that did not ` +
          `happen misstates the legal status of the debt.`
      })
    ];
  }

  // A chapter that contradicts the bankruptcy the consumer actually filed.
  const chapter = str(bk.chapter);
  const codeChapter = CII_CODES[reported].chapter ?? null;
  if (chapter !== null && codeChapter !== null && codeChapter !== chapter) {
    const wanted = CII_CODES[reported].discharged ? CHAPTER_TO_DISCHARGED_CII[chapter] : null;
    return [
      violation({
        ruleId: "M2-009",
        field: "38",
        observed: reported,
        expected: wanted ?? `an indicator for Chapter ${chapter}`,
        reason:
          `Consumer Information Indicator ${reported} reports a Chapter ${codeChapter} bankruptcy, ` +
          `but the bankruptcy affecting this account was Chapter ${chapter}. The wrong chapter ` +
          `misstates what relief the court granted.`
      })
    ];
  }

  return [];
}

/**
 * Check 10 — Field 20. Is the Compliance Condition Code appropriate?
 *
 * SCOPE, deliberately narrowed, for the same no-double-counting reason as
 * M2-009. § 5.1's trigger text ("XH used when consumer still disagrees; stale
 * XB") names two defects that § 5.5's checks 29 and 30 detect in full, with the
 * dispute timeline they need. So:
 *
 *   M2-010 (here)  a CCC that is structurally wrong on its own terms — an
 *                  unrecognised code, or a code requiring Date Closed reported
 *                  without one.
 *   M2-029         XB left on after the investigation closed.
 *   M2-030         XH where the consumer disagrees and XC is correct.
 *
 * Recorded in docs/metro2/README.md.
 */
export function checkComplianceConditionCode(tradeline, context) {
  const reported = str(tradeline?.field_20_compliance_condition);
  if (reported === null) return [];

  if (!isComplianceCode(reported)) {
    return [
      violation({
        ruleId: "M2-010",
        field: "20",
        observed: reported,
        expected: Object.keys(COMPLIANCE_CODES),
        reason:
          `Compliance Condition Code ${reported} is not a code Exhibit 8 defines. A compliance flag ` +
          `outside the permitted set does not record any recognised dispute or closure condition.`
      })
    ];
  }

  if (REQUIRE_DATE_CLOSED_CODES.includes(reported) && isAbsent(tradeline?.field_26_date_closed)) {
    return [
      violation({
        ruleId: "M2-010",
        field: "20",
        observed: { field_20: reported, field_26: null },
        expected: "Date Closed populated, matching the date the consumer closed the account",
        reason:
          `Compliance Condition Code ${reported} (${COMPLIANCE_CODES[reported].meaning}) asserts the ` +
          `account was closed at the consumer's request, but no Date Closed is reported. The closure ` +
          `it claims cannot be verified without the date it happened.`
      })
    ];
  }

  return [];
}

/** § 5.1's ten checks, in the knowledge base's order. */
export const UNIVERSAL_CHECKS = Object.freeze([
  ["M2-001", checkAccountNumberAccuracy],
  ["M2-002", checkDateOpenedAcrossBureaus],
  ["M2-003", checkPortfolioType],
  ["M2-004", checkAccountType],
  ["M2-005", checkStaleAccountInformation],
  ["M2-006", checkDofdPresentAndConsistent],
  ["M2-007", checkSevenYearWindowExpired],
  ["M2-008", checkEcoaCode],
  ["M2-009", checkConsumerInformationIndicator],
  ["M2-010", checkComplianceConditionCode]
]);

// Re-exported so sibling check modules can share the status lookup without
// reaching back into the rules directory for a second import.
export { STATUS_CODES, statusDef, normalizeText, sameText };
