// Event handlers for repair.* — move cards; never invent specialist review.
// Also queue the matching repair email (email only — owner §2.4).

import { moveRepairCard, stallRepairCard, EVENT_STAGE } from "./pipeline.mjs";
import { canLeaveIntake } from "./croa.mjs";
import { isBreached } from "./sla.mjs";
import { logDecision } from "../metro2/rounds/store.mjs";
import { notifyRepairEmail } from "./notify.mjs";

export async function onRepairEvent(db, event) {
  const name = event?.name || event?.type;
  const orgId = event.orgId || event.payload?.orgId;
  const clientId = event.clientId || event.payload?.clientId;
  if (!name || !orgId || !clientId) return { ok: false, reason: "missing_ids" };

  // Retake is email-only — do not move the optimization card.
  if (name === "repair.response.retake") {
    const email = await notifyRepairEmail(db, {
      name,
      orgId,
      clientId,
      payload: event.payload || {}
    }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
    if (db?.query) {
      await logDecision(db, {
        orgId, clientId, caseId: event.payload?.caseId,
        decision: name,
        payload: event.payload || {}
      }).catch(() => {});
    }
    return { ok: true, emailOnly: true, email };
  }

  if (name === "repair.docs.complete" || name === "repair.enrolled") {
    // Leaving intake requires CROA gate when advancing past intake
  }

  if (name === "repair.docs.needed") {
    // May only leave intake after CROA window if coming from intake enrollment path
    const gate = canLeaveIntake({
      enrolledAt: event.payload?.enrolledAt,
      asOf: event.payload?.asOf,
      contract: event.payload?.contract
    });
    if (event.payload?.fromIntake && !gate.ok) {
      return { ok: false, reason: gate.reason, gate };
    }
  }

  const stageKey = EVENT_STAGE[name];
  if (!stageKey) return { ok: false, reason: "unknown_event" };

  if (stageKey === "stalled" || name === "repair.stalled" || name === "repair.analysis.empty") {
    const r = await stallRepairCard(db, { orgId, clientId, reason: event.payload?.reason || name });
    if (db?.query) {
      await logDecision(db, {
        orgId, clientId, caseId: event.payload?.caseId,
        decision: name,
        payload: event.payload || {}
      }).catch(() => {});
    }
    const email = await notifyRepairEmail(db, {
      name,
      orgId,
      clientId,
      payload: event.payload || {}
    }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
    return { ok: true, ...r, email };
  }

  const moved = await moveRepairCard(db, { orgId, clientId, stageKey });
  const email = await notifyRepairEmail(db, {
    name,
    orgId,
    clientId,
    payload: event.payload || {}
  }).catch((err) => ({ sent: false, reason: String(err?.message || err) }));
  return { ok: !!moved?.moved, moved, stageKey, email };
}

export function evaluateSlaBreach(card) {
  return isBreached({
    stageKey: card.stageKey,
    enteredAt: card.enteredAt,
    asOf: card.asOf,
    responseDueAt: card.responseDueAt
  });
}
