// Human confirmation gate before escalation. Wrong parse is expensive.

import { advanceAfterParse } from "../rounds/advance.mjs";
import { needsUpsellPending, markUpsellPending } from "../rounds/program-cap.mjs";
import { logDecision } from "../rounds/store.mjs";

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

  return { ok: true, ...advanced, confidence: parseResult.confidence, upsell };
}

export { DEFAULT_THRESHOLD };
