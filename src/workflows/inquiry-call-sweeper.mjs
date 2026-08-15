// Sweeper — fire AI bureau calls when call_due_at elapses.
// Defined for Inngest cron registration; deliberately not auto-activated
// (same posture as message-dispatch-sweeper). Call fireDueCalls from tests
// or when the owner turns the schedule on.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { fireDueCalls } from "../inquiry-ops/call-scheduler.mjs";

export async function handle({ db: database, step, event } = {}) {
  // Soft-skip: cron wiring can arrive without a db or step. Never throw.
  if (event !== undefined && (event === null || typeof event !== "object" || Array.isArray(event))) {
    return { fired: [], count: 0, reason: "no_event" };
  }
  if (!database || typeof database.query !== "function") {
    return { fired: [], count: 0, reason: "no_db" };
  }
  if (!step || typeof step.run !== "function") {
    return { fired: [], count: 0, reason: "no_step" };
  }
  return step.run("fire-due-inquiry-calls", () => fireDueCalls(database, {}));
}

export const inquiryCallSweeper = inngest.createFunction(
  { id: "inquiry-call-sweeper", name: "Inquiry call sweeper (delivery + configured wait)" },
  { cron: "*/15 * * * *" },
  async ({ step }) => handle({ db, step })
);

// Not registered in workflows/index.mjs until owner enables the schedule.
