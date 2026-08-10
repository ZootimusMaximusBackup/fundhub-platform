// Five safety rules before auto-send / escalation (pipeline spec §5b).

import { assertCitationsByteIdentical } from "../metro2/letters/citations-assert.mjs";
import { assertBelowThreshold, assertBatchVariance } from "../metro2/letters/variance.mjs";
import { filterForDispatch } from "../metro2/rounds/advance.mjs";

/**
 * Rule 1 — every claim has a ruleId.
 * Rule 2 — variance gate.
 * Rule 3 — low-confidence parse never auto-acts (caller).
 * Rule 4 — recheck fresh pull before escalate.
 * Rule 5 — caller must log decisions (repair_decision_log).
 */
export function assertReadyToSend({
  letterText,
  violations,
  priorLetters = [],
  batchLetters = null,
  threshold = 0.35
}) {
  const withoutId = (violations || []).filter((v) => !v?.ruleId);
  if (withoutId.length || !(violations || []).length) {
    return { ok: false, rule: 1, reason: "rule_id_required" };
  }
  const cites = assertCitationsByteIdentical(letterText, violations);
  if (!cites.ok) return { ok: false, rule: 1, reason: "citation_drift", detail: cites };

  if (batchLetters) {
    const batch = assertBatchVariance(batchLetters, threshold);
    if (!batch.ok) return { ok: false, rule: 2, reason: "batch_variance", detail: batch };
  } else {
    const gate = assertBelowThreshold(letterText, priorLetters, threshold);
    if (!gate.ok) return { ok: false, rule: 2, reason: "variance_gate", detail: gate };
  }
  return { ok: true };
}

export function assertEscalationSafe({ items, latestReportItems }) {
  const { keep, closed } = filterForDispatch(items, latestReportItems);
  if (keep.length === 0 && closed.length > 0) {
    return { ok: false, rule: 4, reason: "all_items_gone_on_recheck", closed };
  }
  return { ok: true, keep, closed };
}

export function shouldAutoAdvanceParse(confidence, threshold = 0.85) {
  return Number(confidence) >= threshold;
}
