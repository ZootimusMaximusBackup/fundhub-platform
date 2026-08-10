// § 5.4 — Bankruptcy checks. Rules M2-024 … M2-027.
//
// The strongest tier in the engine sits here. A discharged debt is not a debt
// the consumer is behind on — it is a debt a federal court has said no longer
// exists. Reporting a balance on it is both an FCRA accuracy failure and, per
// § 1.11, a potential violation of the Bankruptcy Code § 524 discharge
// injunction, which is a court order rather than a reporting standard. That is
// why M2-025 is the one rule here in the deletion tier.
//
// ── WHERE THE BANKRUPTCY FACTS COME FROM ──────────────────────────────────
//
// `context.bankruptcy` — whether the consumer filed, which chapter, whether it
// discharged, whether it was dismissed. None of that is on the tradeline; it
// belongs to the consumer, and every field of it is provenance-wrapped. A
// discharge nobody has told us about leaves all four rules silent, which is
// right: without knowing a discharge happened we have no basis to say the
// balance is wrong.
//
// The one exception is M2-025, which reads the discharge out of Field 38 itself.
// The furnisher's own bankruptcy indicator saying "discharged through Chapter 7"
// is the furnisher's own admission, and a balance beside it contradicts it with
// no outside evidence needed. `context.bankruptcy.dismissed` can still stop the
// rule — § 5.4 scopes the violation to a discharge "without dismissal".

import { isObserved, isVisible } from "../provenance.mjs";
import { violation, num, str, isTrue, formatCents } from "./violation.mjs";
import { STATUS_CODES, DELINQUENT_STATUSES, statusDef } from "../rules/status-codes.mjs";
import {
  CII_CODES,
  CII_DISCHARGED_CODES,
  CHAPTER_TO_DISCHARGED_CII,
  isDischargedCii
} from "../rules/cii-codes.mjs";
import { ECOA_CODES, ECOA_AUTHORIZED_USER, ECOA_DELETE_CONSUMER } from "../rules/ecoa-codes.mjs";

/** Check 24 — Field 38. Account included in a discharged bankruptcy: is CII E/F/G/H present? */
export function checkMissingPostDischargeCii(tradeline, context) {
  const bk = context?.bankruptcy ?? {};
  if (!isTrue(bk.included) || !isTrue(bk.discharged)) return [];

  const cii = tradeline?.field_38_cii;
  // Cannot see Field 38 at all: not our finding to make.
  if (!isVisible(cii)) return [];
  const reported = str(cii);
  // Already recording a discharge — nothing missing.
  if (reported !== null && isDischargedCii(reported)) return [];

  const chapter = str(bk.chapter);
  const wanted = chapter !== null ? CHAPTER_TO_DISCHARGED_CII[chapter] : null;

  return [
    violation({
      ruleId: "M2-024",
      field: "38",
      observed: reported,
      expected: wanted ?? CII_DISCHARGED_CODES,
      reason:
        `This account was included in a bankruptcy that has been discharged` +
        `${chapter ? ` under Chapter ${chapter}` : ""}, but the Consumer Information Indicator ` +
        `${reported === null ? "is empty" : `reports ${reported} ("${CII_CODES[reported]?.meaning ?? reported}")`}. ` +
        `The file needs ${wanted ? `indicator ${wanted} ("${CII_CODES[wanted].meaning}")` : "a discharge indicator"} ` +
        `so that anyone reading it can see the debt was discharged by the court.`
    })
  ];
}

/** Check 25 — 38 + 21. Is a discharged account still showing a balance or arrears? */
export function checkDischargedAccountWithBalance(tradeline, context) {
  const cii = str(tradeline?.field_38_cii);
  if (cii === null || !isDischargedCii(cii)) return [];

  // § 5.4 scopes this to a discharge "without dismissal". A dismissed case
  // means no discharge took effect and the debt survives.
  const dismissed = context?.bankruptcy?.dismissed;
  if (isObserved(dismissed) && dismissed.value === true) return [];

  const balance = num(tradeline?.field_21_current_balance);
  const pastDue = num(tradeline?.field_22_amount_past_due);
  const owing = [];
  if (balance !== null && balance > 0) owing.push({ field: "21", label: "Current Balance", cents: balance });
  if (pastDue !== null && pastDue > 0) owing.push({ field: "22", label: "Amount Past Due", cents: pastDue });
  if (owing.length === 0) return [];

  return [
    violation({
      ruleId: "M2-025",
      field: owing[0].field,
      observed: Object.fromEntries(owing.map((o) => [o.field, o.cents])),
      expected: 0,
      reason:
        `The Consumer Information Indicator reports ${cii} ("${CII_CODES[cii].meaning}"), yet the ` +
        `account still shows ${owing.map((o) => `${o.label} of ${formatCents(o.cents)}`).join(" and ")}. ` +
        `A discharged debt is no longer owed — the court's discharge order says so — so nothing may ` +
        `be reported as outstanding on it.`
    })
  ];
}

/** Check 26 — Field 37. Authorized user on an account in bankruptcy: is ECOA Code Z applied? */
export function checkAuthorizedUserInBankruptcy(tradeline, context) {
  const ecoa = str(tradeline?.field_37_ecoa);
  if (ecoa !== ECOA_AUTHORIZED_USER) return [];
  if (!isTrue(context?.bankruptcy?.included)) return [];

  return [
    violation({
      ruleId: "M2-026",
      field: "37",
      observed: ecoa,
      expected: ECOA_DELETE_CONSUMER,
      reason:
        `The ECOA Code is ${ecoa} ("${ECOA_CODES[ecoa].meaning}") on an account included in a ` +
        `bankruptcy. An authorized user has no contractual responsibility for the debt, and the CRRG ` +
        `requires the account to be removed from that person's file with Code ` +
        `${ECOA_DELETE_CONSUMER} ("${ECOA_CODES[ECOA_DELETE_CONSUMER].meaning}"). Leaving it in place ` +
        `attributes a bankrupt debt to someone who never owed it.`
    })
  ];
}

/** Check 27 — 17A + 38. Is a discharged account still reporting a delinquent status? */
export function checkDelinquentStatusOnDischarged(tradeline) {
  const cii = str(tradeline?.field_38_cii);
  const status = str(tradeline?.field_17A_account_status);
  if (cii === null || status === null) return [];
  if (!isDischargedCii(cii)) return [];
  if (!DELINQUENT_STATUSES.includes(status)) return [];

  return [
    violation({
      ruleId: "M2-027",
      field: "17A",
      observed: { field_17A: status, field_38: cii },
      expected: `Account Status 13 ("${STATUS_CODES["13"].meaning}") with the discharge indicator retained`,
      reason:
        `Account Status ${status} ("${statusDef(status).meaning}") is reported alongside Consumer ` +
        `Information Indicator ${cii} ("${CII_CODES[cii].meaning}"). A debt the court has discharged ` +
        `cannot go on accruing delinquency; the account should be reported as status 13 with the ` +
        `discharge indicator kept in place. As reported, a resolved debt reads as an active default.`
    })
  ];
}

/** § 5.4's four checks, in the knowledge base's order. */
export const BANKRUPTCY_CHECKS = Object.freeze([
  ["M2-024", checkMissingPostDischargeCii],
  ["M2-025", checkDischargedAccountWithBalance],
  ["M2-026", checkAuthorizedUserInBankruptcy],
  ["M2-027", checkDelinquentStatusOnDischarged]
]);
