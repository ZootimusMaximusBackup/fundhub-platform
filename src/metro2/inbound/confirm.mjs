// Human confirmation gate before escalation. Wrong parse is expensive.

import { advanceAfterParse } from "../rounds/advance.mjs";
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
  threshold = DEFAULT_THRESHOLD
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
  const advanced = advanceAfterParse({ items, outcomes });
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
  return { ok: true, ...advanced, confidence: parseResult.confidence };
}

export { DEFAULT_THRESHOLD };
