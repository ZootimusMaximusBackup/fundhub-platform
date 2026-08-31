// Human confirmation gate before escalation. Wrong parse is expensive.
// After confirm, emit repair.response.parsed (and round.escalated when needed)
// so WS-D emails queue through onRepairEvent → sendTemplated.

import { advanceAfterParse } from "../rounds/advance.mjs";
import { loadRoundsCap, needsUpsellPending, markUpsellPending } from "../rounds/program-cap.mjs";
import { logDecision } from "../rounds/store.mjs";
import { onRepairEvent } from "../../repair/handlers.mjs";

const DEFAULT_THRESHOLD = 0.85;

const STAFF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A real person, not a machine.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * This is the test that decides whether an item may cross into R4, where the
 * sworn CFPB and state AG complaints live. Only a staff id counts. The
 * auto-parse path passes null, or the sentinel "system_high_confidence", and
 * neither is a person — src/repair/response-agent.test.mjs already pins that the
 * sentinel must never be stored as a staff id, and it must not buy an escalation
 * either.
 */
export function isRealStaffId(value) {
  return typeof value === "string" && STAFF_UUID.test(value.trim());
}

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
  const cap = await loadRoundsCap(db, { orgId, clientId, fallback: roundsCap });
  // Only a real staff id is a human. A confident machine read is not.
  const humanConfirmed = isRealStaffId(confirmedBy);
  const advanced = advanceAfterParse({ items, outcomes, roundsCap: cap, humanConfirmed });

  // An item wanted to cross into R4+ and no person said so. Hold the whole parse
  // exactly the way a low-confidence read is held — same shape, same queue — so
  // somebody sees it and can confirm it. Nothing is advanced and nothing is lost.
  if (advanced.heldForHuman) {
    if (db) {
      await logDecision(db, {
        orgId,
        clientId,
        caseId,
        decision: "parse.held_escalation_needs_human",
        payload: {
          confidence: parseResult.confidence,
          confirmedBy: confirmedBy || null,
          log: advanced.log
        }
      });
    }
    return {
      ok: false,
      reason: "escalation_needs_human",
      hold: true,
      heldForEscalation: true,
      confidence: parseResult.confidence,
      proposed: outcomes,
      log: advanced.log
    };
  }
  if (db) {
    await logDecision(db, {
      orgId,
      clientId,
      caseId,
      decision: "parse.confirmed",
      payload: {
        confidence: parseResult.confidence,
        confirmedBy: confirmedBy || null,
        roundsCap: cap,
        log: advanced.log
      }
    });
  }

  let upsell = null;
  if (db && needsUpsellPending({ items: advanced.items, roundsCap: cap, log: advanced.log })) {
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
