// Pipeline stage keys + move helpers for the optimization (repair) rail.

import { moveCardToStage } from "../workflows/cards.mjs";
import { STALLED_STAGE } from "./sla.mjs";

export const REPAIR_PIPELINE = "optimization";

export const REPAIR_STAGES = Object.freeze([
  "intake",
  "awaiting_documents",
  "analysis",
  "letters_generated",
  "ready_to_send",
  "in_transit",
  "awaiting_response",
  "response_received",
  "round_complete",
  "program_complete",
  "on_hold",
  "stalled",
  "cancelled"
]);

export async function moveRepairCard(db, { orgId, clientId, stageKey }) {
  return moveCardToStage(db, {
    orgId,
    clientId,
    pipelineKey: REPAIR_PIPELINE,
    stageKey
  });
}

/* readRepairStage — where this client's optimization card is sitting right now.
 *
 * RETURNS NULL WHEN IT CANNOT TELL. No card, no org, or a read that failed all
 * answer null, and null means unknown — never "intake". A caller deciding
 * whether an upload may advance the file must treat unknown as "do not move",
 * because the alternative is dragging a round-5 card backwards. */
export async function readRepairStage(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return null;
  try {
    const r = await db.query(
      `SELECT ps.key AS stage_key
         FROM cards c
         JOIN pipeline_stages ps ON ps.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id AND p.key = $3
        WHERE c.org_id = $1::uuid AND c.client_id = $2::uuid
        LIMIT 1`,
      [orgId, clientId, REPAIR_PIPELINE]
    );
    return r.rows?.[0]?.stage_key ?? null;
  } catch (err) {
    console.warn("[repair] stage read failed:", err && err.message);
    return null;
  }
}

export async function stallRepairCard(db, { orgId, clientId, reason }) {
  const moved = await moveRepairCard(db, { orgId, clientId, stageKey: STALLED_STAGE });
  return { ...moved, stalled: true, reason };
}

/** Map repair.* events → stage keys. */
export const EVENT_STAGE = Object.freeze({
  "repair.enrolled": "intake",
  "repair.docs.needed": "awaiting_documents",
  "repair.docs.complete": "analysis",
  "repair.analysis.complete": "letters_generated",
  "repair.analysis.empty": "stalled",
  "repair.letters.ready": "ready_to_send",
  "repair.letters.sent": "in_transit",
  "repair.letters.delivered": "awaiting_response",
  "repair.response.received": "response_received",
  "repair.response.parsed": "round_complete",
  "repair.parse.low_confidence": "response_received",
  "repair.round.complete": "round_complete",
  "repair.round.escalated": "analysis",
  "repair.program.complete": "program_complete",
  "repair.stalled": "stalled",
  "repair.cancelled": "cancelled"
});
