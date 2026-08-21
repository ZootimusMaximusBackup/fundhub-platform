// Register repair.* bus handlers. Import once from app boot / workflows index.

import { on } from "../events/registry.mjs";
import { onRepairEvent } from "./handlers.mjs";

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
}

export { REPAIR_EVENTS };
