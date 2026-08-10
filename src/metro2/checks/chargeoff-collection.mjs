// § 5.3 — Charge-off and collection checks. Rules M2-018 … M2-023.
//
// This is where the money is. Collections and charge-offs are the tradelines a
// consumer most wants gone, and they are also the ones furnishers report worst:
// a debt sold twice while both parties keep showing a balance, a collector who
// never names the original creditor, a medical bill reported before the one-year
// wait had run.
//
// ── TWO FIELDS THAT DECIDE WHETHER THESE RULES CAN FIRE AT ALL ────────────
//
// `furnisher_is_third_party_collector` and `is_medical_debt` are not Metro 2
// fields. The format carries the answers inside Field 9's industry code
// (Exhibit 1), and the knowledge base references Exhibit 1 without reproducing
// it — so there is no code table in this repo to read them out of.
//
// They are therefore provenance-wrapped inputs like any other, and on a
// consumer soft pull they are `not_visible`. That makes M2-017, M2-019, M2-022
// and M2-023 inert on CRS data, which is the honest outcome: we would be
// guessing that "MIDLAND FUNDING" is a debt buyer from its name. When the
// intake process captures the answer from the consumer or from Exhibit 1, these
// four rules start working with no code change.

import { isObserved, isAbsent, isVisible } from "../provenance.mjs";
import { violation, num, str, list, isTrue, formatCents, sameText, opt } from "./violation.mjs";
import { daysBetween } from "../dates.mjs";
import { STATUS_CODES, THIRD_PARTY_COLLECTOR_STATUSES, statusDef } from "../rules/status-codes.mjs";
import { SALE_INDICATING_COMMENTS, SPECIAL_COMMENTS } from "../rules/special-comments.mjs";

/** Statuses that report the account as a collection, per Exhibit 4. */
const COLLECTION_STATUSES = Object.freeze(["93", "62"]);

/**
 * Is this a collection account?
 * True when the furnisher is a third-party collector, or when the status itself
 * says the account is in collections. Null when neither input is visible.
 */
export function isCollectionAccount(tradeline) {
  if (isTrue(tradeline?.furnisher_is_third_party_collector)) return true;
  const status = str(tradeline?.field_17A_account_status);
  if (status !== null) return COLLECTION_STATUSES.includes(status);
  return isVisible(tradeline?.furnisher_is_third_party_collector) ? false : null;
}

/**
 * What tells us this account changed hands?
 *
 * M2-018 asks whether the balance was zeroed "after sale", so it needs evidence
 * a sale happened before it can call a balance wrong. Three sources count, and
 * none of them is a guess:
 *   - K2 Sold To is populated (the segment that records the sale);
 *   - Special Comment AH, "Purchased by another company";
 *   - the intake captured the sale explicitly.
 * Returns the source name, or null.
 */
export function saleEvidence(tradeline, context) {
  if (isObserved(tradeline?.k2_sold_to)) return "K2 Sold To segment";
  const comment = str(tradeline?.field_19_special_comment);
  if (comment !== null && SALE_INDICATING_COMMENTS.includes(comment)) {
    return `Special Comment ${comment} (${SPECIAL_COMMENTS[comment].meaning})`;
  }
  if (isTrue(context?.saleIndicated)) return "confirmed transfer of the account";
  return null;
}

/** Check 18 — 21 + K2. For a charge-off that was sold, is the balance $0 and K2 populated? */
export function checkChargeOffSoldBalance(tradeline, context) {
  const status = str(tradeline?.field_17A_account_status);
  if (status !== "97") return [];
  const evidence = saleEvidence(tradeline, context);
  if (evidence === null) return [];

  const found = [];
  const balance = num(tradeline?.field_21_current_balance);
  if (balance !== null && balance > 0) {
    found.push(
      violation({
        ruleId: "M2-018",
        subcase: "balance_after_sale",
        field: "21",
        observed: balance,
        expected: 0,
        reason:
          `This charge-off was sold — ${evidence} — yet the Current Balance is still reported as ` +
          `${formatCents(balance)}. Once the debt is sold the seller no longer holds it, so the ` +
          `balance here must be $0.00 with the buyer named in the K2 Sold To segment. As reported, ` +
          `the same debt appears to be owed to two parties.`
      })
    );
  }

  if (isAbsent(tradeline?.k2_sold_to)) {
    found.push(
      violation({
        ruleId: "M2-018",
        subcase: "k2_sold_to_absent",
        field: "K2",
        observed: null,
        expected: "the K2 Sold To segment naming the party that bought the debt",
        reason:
          `This charge-off was sold — ${evidence} — but no K2 Sold To segment names the buyer. ` +
          `Without it the file does not show who now holds the debt, and the transfer cannot be traced.`
      })
    );
  }

  return found;
}

/** Check 19 — K1. For a collection account, is the Original Creditor populated? */
export function checkCollectionMissingK1(tradeline) {
  if (isCollectionAccount(tradeline) !== true) return [];
  if (!isAbsent(tradeline?.k1_original_creditor)) return [];

  return [
    violation({
      ruleId: "M2-019",
      field: "K1",
      observed: null,
      expected: "the K1 segment naming the original creditor",
      reason:
        `This account is reported as a collection, but no K1 segment names the original creditor. The ` +
        `format requires it from collection agencies and debt buyers for a plain reason: without the ` +
        `name of the company the debt started with, the consumer cannot tell what the debt is or ` +
        `whether it is theirs, and cannot meaningfully dispute it.`
    })
  ];
}

/** Check 20 — Field 23. For a charge-off, is the Original Charge-off Amount reported? */
export function checkChargeOffAmountMissing(tradeline) {
  const status = str(tradeline?.field_17A_account_status);
  if (status === null) return [];
  if (!STATUS_CODES[status]?.chargeOffAmountRequired) return [];
  if (!isAbsent(tradeline?.field_23_original_chargeoff_amount)) return [];

  return [
    violation({
      ruleId: "M2-020",
      field: "23",
      observed: null,
      expected: "the amount the account was carrying when it was charged off",
      reason:
        `Account Status ${status} reports this account as charged off, but no Original Charge-off ` +
        `Amount is reported. That figure is what fixes the size of the loss claimed; without it the ` +
        `amount being reported against the consumer cannot be checked against anything.`
    })
  ];
}

/** Check 21 — Is the same debt reported by both the original creditor and a collector? */
export function checkDoubleReporting(tradeline, context) {
  const myBalance = num(tradeline?.field_21_current_balance);
  const related = list(context?.relatedTradelines);
  if (myBalance === null || myBalance <= 0 || related === null) return [];

  const mineIsCollection = isCollectionAccount(tradeline);
  if (mineIsCollection === null) return [];

  const conflicting = related.filter((other) => {
    const otherBalance = num(other?.field_21_current_balance);
    if (otherBalance === null || otherBalance <= 0) return false;
    const otherIsCollection = isCollectionAccount(other);
    if (otherIsCollection === null) return false;
    // One side must be the collection and the other the original account —
    // two collections with balances is a different defect, and two original
    // accounts with balances are simply two accounts.
    return otherIsCollection !== mineIsCollection;
  });
  if (conflicting.length === 0) return [];

  const other = conflicting[0];
  return [
    violation({
      ruleId: "M2-021",
      field: "21",
      observed: {
        thisCreditor: str(tradeline?.creditor),
        thisBalance: myBalance,
        otherCreditor: str(other?.creditor),
        otherBalance: num(other?.field_21_current_balance)
      },
      expected: "one balance for one debt — the party that no longer holds it reporting $0",
      reason:
        `${str(tradeline?.creditor) ?? "This furnisher"} reports a balance of ${formatCents(myBalance)} ` +
        `and ${str(other?.creditor) ?? "another furnisher"} reports ` +
        `${formatCents(num(other?.field_21_current_balance)) ?? "a balance"} on the same debt. Only one ` +
        `party can be owed the money. Reporting it twice doubles the amount of debt the file shows.`
    })
  ];
}

/** Check 22 — Is this a medical collection under $500? */
export function checkMedicalDebtUnderThreshold(tradeline, context) {
  if (!isTrue(tradeline?.is_medical_debt)) return [];
  const balance = num(tradeline?.field_21_current_balance);
  if (balance === null) return [];
  const floor = opt(context, "medicalMinCents");
  if (!(balance > 0 && balance < floor)) return [];

  return [
    violation({
      ruleId: "M2-022",
      field: "21",
      observed: balance,
      expected: `medical collections below ${formatCents(floor)} removed from the file`,
      reason:
        `This is a medical collection with a balance of ${formatCents(balance)}, which is below the ` +
        `${formatCents(floor)} floor. Medical collections under that amount are not reportable and ` +
        `must be removed.`
    })
  ];
}

/** Check 23 — Is this medical debt reported within 365 days of the DOFD? */
export function checkMedicalDebtTooSoon(tradeline, context) {
  if (!isTrue(tradeline?.is_medical_debt)) return [];
  const dofd = str(tradeline?.field_25_dofd);
  const asOf = typeof context?.asOf === "string" ? context.asOf : null;
  if (dofd === null || asOf === null) return [];

  const wait = opt(context, "medicalWaitDays");
  const elapsed = daysBetween(dofd, asOf);
  if (elapsed === null || elapsed >= wait) return [];

  return [
    violation({
      ruleId: "M2-023",
      field: "25",
      observed: { dofd, daysElapsed: elapsed },
      expected: `no reporting until ${wait} days after ${dofd}`,
      reason:
        `This medical debt has a Date of First Delinquency of ${dofd}, which is only ${elapsed} days ` +
        `before the report date. Medical debt may not be reported until at least ${wait} days have ` +
        `passed, so it should not be in the file yet.`
    })
  ];
}

/** § 5.3's six checks, in the knowledge base's order. */
export const CHARGEOFF_COLLECTION_CHECKS = Object.freeze([
  ["M2-018", checkChargeOffSoldBalance],
  ["M2-019", checkCollectionMissingK1],
  ["M2-020", checkChargeOffAmountMissing],
  ["M2-021", checkDoubleReporting],
  ["M2-022", checkMedicalDebtUnderThreshold],
  ["M2-023", checkMedicalDebtTooSoon]
]);

export { COLLECTION_STATUSES, THIRD_PARTY_COLLECTOR_STATUSES, statusDef, sameText };
