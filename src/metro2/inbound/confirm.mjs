// Human confirmation gate before escalation. Wrong parse is expensive.
// After confirm, emit repair.response.parsed (and round.escalated when needed)
// so WS-D emails queue through onRepairEvent → sendTemplated.

import { advanceAfterParse } from "../rounds/advance.mjs";
import { needsUpsellPending, markUpsellPending } from "../rounds/program-cap.mjs";
import { logDecision } from "../rounds/store.mjs";
import { onRepairEvent } from "../../repair/handlers.mjs";

const DEFAULT_THRESHOLD = 0.85;

/**
 * Confirm a parse (or reject). Only confirmed outcomes advance items.
 */
export async function confirmParse(db, {
  orgId,
  clientId,
  caseId,
  items,
  parseResult,
  confirmedOutcomes,
  confirmedBy,
  threshold = DEFAULT_THRESHOLD,
  roundsCap = 6,
  staffId = null
}) {
  if (!parseResult) return { ok: false, reason: "no_parse" };

  if (parseResult.confidence < threshold && !confirmedOutcomes) {
    if (db) {
      await logDecision(db, {
        orgId,
        clientId,
        caseId,
        decision: "parse.held_low_confidence",
        payload: { confidence: parseResult.confidence, threshold }
      });
    }
    return {
      ok: false,
      reason: "low_confidence",
      hold: true,
      confidence: parseResult.confidence,
      proposed: parseResult.outcomes
    };
  }

  const outcomes = confirmedOutcomes || parseResult.outcomes;
  const advanced = advanceAfterParse({ items, outcomes, roundsCap });
  if (db) {
    await logDecision(db, {
      orgId,
      clientId,
      caseId,
      decision: "parse.confirmed",
      payload: {
        confidence: parseResult.confidence,
        confirmedBy: confirmedBy || null,
        log: advanced.log
      }
    });
  }

  let upsell = null;
  if (db && needsUpsellPending({ items: advanced.items, roundsCap, log: advanced.log })) {
    upsell = await markUpsellPending(db, { orgId, clientId, staffId: staffId || confirmedBy });
  }

  const outcomeRows = (advanced.log || []).map((row) => {
    const item = (items || []).find((it) => String(it.id) === String(row.itemId)) || {};
    return {
      creditor: item.creditor,
      accountLast4: item.account_last4 || item.accountLast4,
      bureau: item.bureau,
      outcome: row.outcome
    };
  });

  let email = null;
  let escalateEmail = null;
  if (db && orgId && clientId) {
    email = await onRepairEvent(db, {
      name: "repair.response.parsed",
      orgId,
      clientId,
      payload: {
        caseId,
        outcomes: outcomeRows,
        confirmedBy: confirmedBy || null,
        eventId: `repair-parsed:${orgId}:${clientId}:${caseId || "nocase"}:${parseResult.confidence}`
      }
    }).catch((err) => ({ ok: false, reason: String(err?.message || err) }));

    if ((advanced.escalate || []).length) {
      const escalatedRows = advanced.escalate.map((it) => ({
        creditor: it.creditor,
        accountLast4: it.account_last4 || it.accountLast4,
        bureau: it.bureau,
        why: "bureau verified or left this open — next round"
      }));
      escalateEmail = await onRepairEvent(db, {
        name: "repair.round.escalated",
        orgId,
        clientId,
        payload: {
          caseId,
          escalated: escalatedRows,
          round: advanced.escalate[0]?.round || "next",
          eventId: `repair-escalated:${orgId}:${clientId}:${caseId || "nocase"}`
        }
      }).catch((err) => ({ ok: false, reason: String(err?.message || err) }));
    }
  }

  return { ok: true, ...advanced, confidence: parseResult.confidence, upsell, email, escalateEmail };
}

export { DEFAULT_THRESHOLD };
