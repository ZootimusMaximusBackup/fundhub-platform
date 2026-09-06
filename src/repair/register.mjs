// Register repair.* bus handlers. Import once from app boot / workflows index.

import { on } from "../events/registry.mjs";
import { onRepairEvent, onRepairDocsReceived } from "./handlers.mjs";

const REPAIR_EVENTS = [
  "repair.enrolled",
  "repair.docs.needed",
  "repair.docs.complete",
  "repair.analysis.complete",
  "repair.analysis.empty",
  "repair.letters.ready",
  "repair.letters.sent",
  "repair.letters.delivered",
  "repair.response.received",
  "repair.response.parsed",
  "repair.parse.low_confidence",
  "repair.response.retake",
  "repair.round.complete",
  "repair.round.escalated",
  "repair.program.complete",
  "repair.stalled",
  "repair.cancelled"
];

let registered = false;

export function registerRepairHandlers() {
  if (registered) return;
  registered = true;
  for (const name of REPAIR_EVENTS) {
    on(name, (event, db) => onRepairEvent(db, event));
  }
  /* An upload is how awaiting_documents ENDS. Without this the stage had an
     entrance and no exit: repair.docs.complete was in the pipeline map, in the
     stage copy and in the email templates, and nothing on any upload path
     emitted it. Every guard lives in the handler — it refuses anything that is
     not a repair client sitting on a stage that is actually waiting. */
  on("docs.received", onRepairDocsReceived);
}

export { REPAIR_EVENTS };
