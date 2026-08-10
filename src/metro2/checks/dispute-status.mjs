// § 5.5 — Dispute status checks. Rules M2-028 … M2-030.
//
// Field 20 is where a furnisher records that an account is in dispute, and these
// three rules are the ones that hold it to that. § 1681s-2(a)(3) says a
// furnisher who has been told information is disputed may not keep furnishing it
// without saying so. Saunders (4th Cir.) and Gorman (9th Cir.) both turn on
// exactly that failure.
//
// M2-030 is the one worth understanding. Three codes describe the end of an
// investigation and they are not interchangeable:
//
//   XB  disputed, investigation in progress   — must come off when it closes
//   XH  previously disputed, investigation complete — silent on the outcome
//   XC  investigation complete, consumer still disagrees
//
// A furnisher that closes an investigation the consumer rejected and reports XH
// has dropped the disagreement out of the file. The account reads as settled when
// it is not. That is the Fulton / Wood / Matson pattern.
//
// ── THE DISPUTE TIMELINE IS NOT IN THE CREDIT REPORT ──────────────────────
//
// Whether a dispute is open, whether the investigation closed, and whether the
// consumer accepted the outcome are facts about the case file, not the tradeline.
// They arrive on `context.dispute`, provenance-wrapped. On a bare soft pull with
// no case history all three rules stay silent — which is correct, because a
// furnisher cannot be faulted for omitting a dispute flag for a dispute that was
// never made.

import { isVisible } from "../provenance.mjs";
import { violation, str, isTrue } from "./violation.mjs";
import {
  COMPLIANCE_CODES,
  DISPUTE_IN_PROGRESS_CODES,
  REMOVE_AFTER_INVESTIGATION_CODES,
  CONSUMER_DISAGREES_CODES
} from "../rules/compliance-codes.mjs";

/** Check 28 — Field 20. Active dispute, but no dispute code reported? */
export function checkActiveDisputeNotFlagged(tradeline, context) {
  const dispute = context?.dispute ?? {};
  if (!isTrue(dispute.active)) return [];
  // An investigation that has already closed is not an open dispute; the
  // correct code then is an outcome code, which is M2-029's and M2-030's ground.
  if (isTrue(dispute.investigationCompleted)) return [];

  const ccc = tradeline?.field_20_compliance_condition;
  if (!isVisible(ccc)) return [];
  const reported = str(ccc);
  if (reported !== null && DISPUTE_IN_PROGRESS_CODES.includes(reported)) return [];

  return [
    violation({
      ruleId: "M2-028",
      field: "20",
      observed: reported,
      expected: DISPUTE_IN_PROGRESS_CODES,
      reason:
        `The consumer has an open dispute on this account, but the Compliance Condition Code ` +
        `${reported === null ? "is empty" : `reports ${reported} ("${COMPLIANCE_CODES[reported]?.meaning ?? reported}")`}. ` +
        `A furnisher told that information is disputed may not keep reporting it without marking it as ` +
        `disputed. Anyone reading this file sees an undisputed debt.`
    })
  ];
}

/** Check 29 — Field 20. Investigation completed, but the in-progress code is still reported? */
export function checkStaleDisputeFlag(tradeline, context) {
  const dispute = context?.dispute ?? {};
  if (!isTrue(dispute.investigationCompleted)) return [];

  const reported = str(tradeline?.field_20_compliance_condition);
  if (reported === null || !REMOVE_AFTER_INVESTIGATION_CODES.includes(reported)) return [];

  const disagrees = isTrue(dispute.consumerDisagreesWithOutcome);
  return [
    violation({
      ruleId: "M2-029",
      field: "20",
      observed: reported,
      expected: disagrees ? CONSUMER_DISAGREES_CODES : "the code removed, or replaced with a completed-investigation code",
      reason:
        `Compliance Condition Code ${reported} ("${COMPLIANCE_CODES[reported].meaning}") is still ` +
        `reported although the investigation has finished. That code means an investigation is in ` +
        `progress and the format requires it to be removed once one is not. Leaving it in place shows ` +
        `the account as permanently under review.`
    })
  ];
}

/** Check 30 — Field 20. Consumer disagrees with the outcome, but XH is reported instead of XC? */
export function checkWrongPostInvestigationCode(tradeline, context) {
  const dispute = context?.dispute ?? {};
  if (!isTrue(dispute.investigationCompleted)) return [];
  if (!isTrue(dispute.consumerDisagreesWithOutcome)) return [];

  const reported = str(tradeline?.field_20_compliance_condition);
  if (reported === null) return [];
  const def = COMPLIANCE_CODES[reported];
  // Only fires where the reported code closes the investigation WITHOUT
  // recording the disagreement. A code that already records it is correct.
  if (!def || def.investigationComplete !== true || def.consumerDisagrees !== false) return [];

  return [
    violation({
      ruleId: "M2-030",
      field: "20",
      observed: reported,
      expected: "XC",
      reason:
        `Compliance Condition Code ${reported} ("${def.meaning}") is reported. The consumer did not ` +
        `accept the result of that investigation and still disputes this account, so the correct code ` +
        `is XC ("${COMPLIANCE_CODES.XC.meaning}"). Code ${reported} says the matter was investigated ` +
        `and stops there, which makes the account read as resolved when the consumer's dispute stands.`
    })
  ];
}

/** § 5.5's three checks, in the knowledge base's order. */
export const DISPUTE_STATUS_CHECKS = Object.freeze([
  ["M2-028", checkActiveDisputeNotFlagged],
  ["M2-029", checkStaleDisputeFlag],
  ["M2-030", checkWrongPostInvestigationCode]
]);
