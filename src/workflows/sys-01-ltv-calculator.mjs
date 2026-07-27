// SYS-01-LTV — Lifetime Value Calculator.
// Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section.
// Trigger: round.funded. Accumulates each round's funded amount into a running
// lifetime-value total — an explicit, unambiguous running sum (not an invented
// formula), so built directly like SYS-01.
//
// Idempotency note: like BC-01/BC-02, a running-total accumulator has no natural
// find-or-create/ON-CONFLICT shape without a per-event ledger table, which doesn't
// exist here. Deduped via the same event-id-guard style as the message/task helpers
// in this directory — stored in custom_fields as the set of already-applied event
// ids for this client (small, bounded by round count per client).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const fundedAmount = Number(event.payload?.fundedAmount ?? 0);
  if (!(fundedAmount > 0)) return { done: false, reason: "no_funded_amount" };

  const r = await step.run("read-ltv-state", () => db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]));
  const cf = r.rows[0]?.custom_fields || {};
  const appliedEventIds = new Set(cf.ltv_applied_event_ids || []);
  if (appliedEventIds.has(event.id)) return { done: false, reason: "already_applied" };

  const newTotal = (cf.lifetime_value || 0) + fundedAmount;
  appliedEventIds.add(event.id);
  await step.run("update-ltv", () => mergeCustomFields(db, clientId, {
    lifetime_value: newTotal,
    ltv_applied_event_ids: [...appliedEventIds]
  }));

  return { done: true, lifetimeValue: newTotal };
}

export const sys01LtvCalculator = inngest.createFunction(
  { id: "sys-01-ltv-calculator", name: "SYS-01-LTV — Lifetime Value Calculator" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
