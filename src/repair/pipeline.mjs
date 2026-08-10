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
