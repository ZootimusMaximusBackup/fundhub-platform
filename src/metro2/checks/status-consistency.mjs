// § 5.2 — Status code consistency. Rules M2-011 … M2-017.
//
// These are the checks that find a tradeline contradicting itself. They are the
// engine's strongest routine findings because they need no outside evidence: an
// account reported as "paid, zero balance" while also reporting $2,100 owed is
// wrong on its own face, and no investigation is required to see it. § 5.8 puts
// status/balance contradictions in the high-leverage tier for that reason.
//
// The constraints come out of the Exhibit 4 table in rules/status-codes.mjs
// rather than being written as branches here, so a new CRRG edition is a table
// edit. Where the knowledge base contradicts itself about a constraint, the
// table records both readings and these checks take the narrower one — see the
// header of rules/status-codes.mjs.
//
// MONEY IS INTEGER CENTS throughout, per the repo convention in
// src/commissions/money.mjs. A null balance means unknown and survives as null;
// it is never defaulted to zero, because "we do not know the balance" and "the
// balance is zero" are opposite findings here.

import { isVisible, isAbsent } from "../provenance.mjs";
import { violation, num, str, isTrue, formatCents, list } from "./violation.mjs";
import { compareIso, monthKey, addMonths } from "../dates.mjs";
import {
  STATUS_CODES,
  ZERO_BALANCE_STATUSES,
  ZERO_PAST_DUE_STATUSES,
  POSITIVE_PAST_DUE_STATUSES,
  PAYMENT_RATING_REQUIRED_STATUSES,
  PROHIBITED_STATUS_SEQUENCES,
  THIRD_PARTY_COLLECTOR_STATUSES,
  statusDef
} from "../rules/status-codes.mjs";
import { PAYMENT_RATINGS, isPaymentRating } from "../rules/payment-ratings.mjs";
import { PHP_CODES, PHP_LATE_CODES, latePositions, derogatoryPositions, phpChars } from "../rules/php-codes.mjs";
import { SPECIAL_COMMENTS, specialCommentDef } from "../rules/special-comments.mjs";

/** Check 11 — 17A + 21. Is Account Status consistent with Current Balance? */
export function checkStatusBalanceConsistency(tradeline) {
  const status = str(tradeline?.field_17A_account_status);
  const balance = num(tradeline?.field_21_current_balance);
  if (status === null || balance === null) return [];
  if (!ZERO_BALANCE_STATUSES.includes(status)) return [];
  if (balance === 0) return [];

  const def = STATUS_CODES[status];
  return [
    violation({
      ruleId: "M2-011",
      field: "21",
      observed: balance,
      expected: 0,
      reason:
        `Account Status ${status} means "${def.meaning}", which Exhibit 4 requires to carry a $0 ` +
        `Current Balance. The balance reported is ${formatCents(balance)}. The account cannot both ` +
        `be settled and still be owed.`
    })
  ];
}

/**
 * Check 12 — 17A + 22. Is Account Status consistent with Amount Past Due?
 *
 * Two arms. § 5.2 names the first ("Status 11 with past-due > 0"); the second
 * comes from Exhibit 4's own "Required Balance" column, which reads
 * "Past due > 0" for statuses 71 through 84.
 */
export function checkStatusPastDueConsistency(tradeline) {
  const status = str(tradeline?.field_17A_account_status);
  const pastDue = num(tradeline?.field_22_amount_past_due);
  if (status === null || pastDue === null) return [];
  const def = statusDef(status);
  if (!def) return [];

  if (ZERO_PAST_DUE_STATUSES.includes(status) && pastDue !== 0) {
    // `pastDueSource` says whether the knowledge base names this status
    // explicitly or whether the constraint follows from its meaning. The letter
    // should not overstate which.
    const explicit = def.pastDueSource === "kb-explicit";
    return [
      violation({
        ruleId: "M2-012",
        subcase: "past_due_on_current_or_paid_status",
        field: "22",
        observed: pastDue,
        expected: 0,
        reason:
          `Account Status ${status} means "${def.meaning}". ` +
          (explicit
            ? `The knowledge base identifies this status combined with an Amount Past Due above $0 as ` +
              `contradictory. `
            : `An account reported as settled in full cannot simultaneously carry arrears. `) +
          `The Amount Past Due reported is ${formatCents(pastDue)}.`
      })
    ];
  }

  if (POSITIVE_PAST_DUE_STATUSES.includes(status) && pastDue === 0) {
    return [
      violation({
        ruleId: "M2-012",
        subcase: "no_past_due_on_delinquent_status",
        field: "22",
        observed: 0,
        expected: "an Amount Past Due above $0",
        reason:
          `Account Status ${status} means "${def.meaning}", and Exhibit 4 requires an Amount Past Due ` +
          `above $0 with it. The Amount Past Due reported is $0.00. An account cannot be behind by ` +
          `${def.meaning.toLowerCase()} while owing nothing.`
      })
    ];
  }

  return [];
}

/** Check 13 — 17A + 17B. Is Account Status consistent with Payment Rating? */
export function checkStatusPaymentRatingConsistency(tradeline) {
  const status = str(tradeline?.field_17A_account_status);
  const rating = tradeline?.field_17B_payment_rating;
  if (status === null) return [];
  const def = statusDef(status);
  if (!def) return [];

  // Nothing below may fire on a Payment Rating we cannot see. An empty
  // `reported` means either "reported blank" or "field not carried by this
  // report format", and only the first is a violation.
  if (!isVisible(rating)) return [];
  const reported = str(rating);

  // A rating that is not in Exhibit 4's nine-value alphabet at all.
  if (reported !== null && !isPaymentRating(reported)) {
    return [
      violation({
        ruleId: "M2-013",
        subcase: "payment_rating_invalid",
        field: "17B",
        observed: reported,
        expected: Object.keys(PAYMENT_RATINGS),
        reason:
          `Payment Rating ${reported} is not one of the nine values the format permits. A rating ` +
          `outside the permitted set describes no verifiable condition of the account.`
      })
    ];
  }

  // The charge-off case § 5.2 names by number: status 97 requires rating L.
  if (def.requiredPaymentRating && reported !== def.requiredPaymentRating) {
    return [
      violation({
        ruleId: "M2-013",
        subcase: "chargeoff_without_rating_L",
        field: "17B",
        observed: reported,
        expected: def.requiredPaymentRating,
        reason:
          `Account Status ${status} means "${def.meaning}", which requires Payment Rating ` +
          `${def.requiredPaymentRating} (${PAYMENT_RATINGS[def.requiredPaymentRating].meaning}). The ` +
          `Payment Rating reported is ${reported === null ? "empty" : reported}. The two fields do ` +
          `not describe the same account.`
      })
    ];
  }

  // A status that requires the field, reported without it.
  if (PAYMENT_RATING_REQUIRED_STATUSES.includes(status) && isAbsent(rating)) {
    return [
      violation({
        ruleId: "M2-013",
        subcase: "payment_rating_absent",
        field: "17B",
        observed: null,
        expected: `a Payment Rating (${Object.keys(PAYMENT_RATINGS).join(", ")})`,
        reason:
          `Account Status ${status} ("${def.meaning}") requires a Payment Rating, which records the ` +
          `condition of the account at the time that final status was reported. No Payment Rating is ` +
          `reported, so the account's condition at that point cannot be verified.`
      })
    ];
  }

  return [];
}

/**
 * Check 14 — 17A + 18. Is Account Status consistent with Payment History Profile?
 *
 * Two arms, both from § 1.5:
 *   (a) late codes 1–6 in the profile while the status says the account is current;
 *   (b) a charge-off code L in a month BEFORE the Date of First Delinquency,
 *       which is internally impossible — the loss cannot predate the delinquency
 *       that caused it.
 *
 * The profile is read newest-to-oldest with index 0 anchored to the month of
 * Field 24, so arm (b) needs Field 24 as well.
 */
export function checkStatusPaymentHistoryConsistency(tradeline) {
  const found = [];
  const status = str(tradeline?.field_17A_account_status);
  const profile = str(tradeline?.field_18_payment_history);
  if (profile === null) return found;

  if (status === "11") {
    const positions = latePositions(profile);
    if (positions.length > 0) {
      const codes = [...new Set(positions.map((i) => profile[i]))];
      found.push(
        violation({
          ruleId: "M2-014",
          subcase: "late_history_on_current_status",
          field: "18",
          observed: { profile, latePositions: positions, codes },
          expected: `no delinquency codes (${PHP_LATE_CODES.join(", ")}) while Account Status is 11`,
          reason:
            `Account Status 11 reports the account as current, but the Payment History Profile shows ` +
            `${positions.length} month(s) marked ` +
            `${codes.map((c) => `${c} (${PHP_CODES[c].meaning})`).join(", ")}. The status and the ` +
            `history contradict each other, and a reader cannot tell which is true.`
        })
      );
    }
  }

  const dofd = str(tradeline?.field_25_dofd);
  const anchor = str(tradeline?.field_24_date_of_account_info);
  if (dofd !== null && anchor !== null) {
    const chargeOffMonths = derogatoryPositions(profile, ["L"])
      // index 0 is the anchor month; index n is n months earlier.
      .map((i) => ({ index: i, month: monthKey(addMonths(anchor, -i)) }))
      .filter((m) => m.month !== null && compareIso(`${m.month}-01`, `${monthKey(dofd)}-01`) === -1);

    if (chargeOffMonths.length > 0) {
      found.push(
        violation({
          ruleId: "M2-014",
          subcase: "php_chargeoff_before_dofd",
          field: "18",
          observed: { profile, dofd, months: chargeOffMonths.map((m) => m.month) },
          expected: `no charge-off months before the Date of First Delinquency (${dofd})`,
          reason:
            `The Payment History Profile marks ${chargeOffMonths.map((m) => m.month).join(", ")} as ` +
            `charged off, but the Date of First Delinquency is reported as ${dofd}. An account cannot ` +
            `have been written off as a loss before the delinquency that caused the loss began.`
        })
      );
    }
  }

  return found;
}

/** Check 15 — 17A. Does Account Status 97 follow 89 or 94? */
export function checkProhibitedStatusSequence(tradeline, context) {
  const current = str(tradeline?.field_17A_account_status);
  const priors = list(context?.priorStatusReports);
  if (current === null || priors === null) return [];

  const offending = priors
    .filter((p) => {
      const prior = typeof p?.status === "string" ? p.status : null;
      if (prior === null) return false;
      const banned = PROHIBITED_STATUS_SEQUENCES[prior];
      return Array.isArray(banned) && banned.includes(current);
    })
    .map((p) => ({ status: p.status, reportedOn: p.reportedOn ?? null }));
  if (offending.length === 0) return [];

  const prior = offending[0];
  return [
    violation({
      ruleId: "M2-015",
      field: "17A",
      observed: { current, prior: prior.status, priorReportedOn: prior.reportedOn },
      expected: `no status ${current} after status ${prior.status}`,
      reason:
        `Account Status ${prior.status} ("${STATUS_CODES[prior.status].meaning}") was reported` +
        `${prior.reportedOn ? ` on ${prior.reportedOn}` : ""}, and Account Status ${current} ` +
        `("${STATUS_CODES[current]?.meaning ?? current}") is reported now. The CRRG prohibits this ` +
        `sequence: the account was already reported as resolved, so it cannot subsequently be ` +
        `reported as an unpaid loss.`
    })
  ];
}

/**
 * Check 16 — 17A + 19. Is the Special Comment Code consistent with Account Status?
 *
 * Only fires on a code Exhibit 7 defines AND whose stated condition is
 * contradicted by a field we can see. The knowledge base reproduces Exhibit 7 as
 * "(Selected)", so an unrecognised Field 19 value is NOT a finding here — it may
 * simply be a code the document does not carry.
 */
export function checkSpecialCommentConsistency(tradeline) {
  const comment = str(tradeline?.field_19_special_comment);
  if (comment === null) return [];
  const def = specialCommentDef(comment);
  if (!def || !def.conditionText) return [];

  const status = str(tradeline?.field_17A_account_status);
  const balance = num(tradeline?.field_21_current_balance);
  const pastDue = num(tradeline?.field_22_amount_past_due);
  const ecoa = str(tradeline?.field_37_ecoa);

  const failures = [];
  if (def.requiresStatusIn && status !== null && !def.requiresStatusIn.includes(status)) {
    failures.push(`Account Status is ${status}, but this comment requires one of ${def.requiresStatusIn.join(", ")}`);
  }
  if (def.requiresStatusNotIn && status !== null && def.requiresStatusNotIn.includes(status)) {
    failures.push(`Account Status is ${status}, which this comment excludes`);
  }
  if (def.requiresBalanceZero && balance !== null && balance !== 0) {
    failures.push(`Current Balance is ${formatCents(balance)}, but this comment requires $0.00`);
  }
  if (def.requiresBalanceNonZero && balance !== null && balance === 0) {
    failures.push(`Current Balance is $0.00, but this comment requires a balance`);
  }
  if (def.requiresPastDueZero && pastDue !== null && pastDue !== 0) {
    failures.push(`Amount Past Due is ${formatCents(pastDue)}, but this comment requires $0.00`);
  }
  if (def.requiresEcoa && ecoa !== null && ecoa !== def.requiresEcoa) {
    failures.push(`ECOA Code is ${ecoa}, but this comment requires ${def.requiresEcoa}`);
  }
  if (def.requiresDateClosed && isAbsent(tradeline?.field_26_date_closed)) {
    failures.push(`no Date Closed is reported, but this comment requires one`);
  }
  if (failures.length === 0) return [];

  return [
    violation({
      ruleId: "M2-016",
      field: "19",
      observed: {
        field_19: comment,
        field_17A: status,
        field_21: balance,
        field_22: pastDue,
        field_37: ecoa
      },
      expected: def.conditionText,
      reason:
        `Special Comment Code ${comment} means "${SPECIAL_COMMENTS[comment].meaning}", which the ` +
        `format permits only when: ${def.conditionText}. On this account, ${failures.join("; ")}. ` +
        `The comment describes a condition the rest of the tradeline contradicts.`
    })
  ];
}

/** Check 17 — 17A. Is a third-party collector using a prohibited status code? */
export function checkCollectorProhibitedStatus(tradeline) {
  if (!isTrue(tradeline?.furnisher_is_third_party_collector)) return [];
  const status = str(tradeline?.field_17A_account_status);
  if (status === null) return [];
  if (THIRD_PARTY_COLLECTOR_STATUSES.includes(status)) return [];

  return [
    violation({
      ruleId: "M2-017",
      field: "17A",
      observed: status,
      expected: THIRD_PARTY_COLLECTOR_STATUSES,
      reason:
        `This account is furnished by a third-party collection agency or debt buyer, which the format ` +
        `limits to Account Status ${THIRD_PARTY_COLLECTOR_STATUSES.join(", ")}. The status reported is ` +
        `${status} ("${STATUS_CODES[status]?.meaning ?? status}"), which only the original creditor may ` +
        `report. Reporting it here misrepresents the collector's relationship to the account.`
    })
  ];
}

/** § 5.2's seven checks, in the knowledge base's order. */
export const STATUS_CONSISTENCY_CHECKS = Object.freeze([
  ["M2-011", checkStatusBalanceConsistency],
  ["M2-012", checkStatusPastDueConsistency],
  ["M2-013", checkStatusPaymentRatingConsistency],
  ["M2-014", checkStatusPaymentHistoryConsistency],
  ["M2-015", checkProhibitedStatusSequence],
  ["M2-016", checkSpecialCommentConsistency],
  ["M2-017", checkCollectorProhibitedStatus]
]);

export { phpChars };
