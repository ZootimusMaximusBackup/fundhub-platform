// F-05 — Inquiry Cleanup Gate (Between Rounds).
// Source: GHL workflow 51d0d34f-7750-4f1e-a3e6-8a0bfb0ce282 (ghl-crm-source-of-truth.md).
//
// Trigger: round.approved (same trigger stage as F-04 — "Stage = Round Approvals").
// Gate: "new inquiries exist" — checked directly against inquiry_log rows that
// aren't already Removed or Pending Removal. Action: flip those to Pending Removal;
// the actual removal work is the Inquiry Removal pipeline (C-02), out of this
// batch's scope. Naturally idempotent (a plain state UPDATE, not an insert) — no
// separate dedup guard needed.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";

async function markPendingRemoval(db, clientId) {
  const r = await db.query(
    `UPDATE inquiry_log SET status = $2 WHERE client_id = $1 AND status IS DISTINCT FROM $2 AND status IS DISTINCT FROM 'Removed'`,
    [clientId, "Pending Removal"]
  );
  return { updated: r.rowCount ?? 0 };
}

export async function handle({ event, db, step }) {
  if (!event || typeof event !== "object") return { done: false, reason: "no_event" };

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const result = await step.run("mark-pending-removal", () => markPendingRemoval(db, clientId));
  return { done: true, ...result };
}

export const f05InquiryCleanupGate = inngest.createFunction(
  { id: "f-05-inquiry-cleanup-gate", name: "F-05 — Inquiry Cleanup Gate" },
  { event: "round.approved" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
