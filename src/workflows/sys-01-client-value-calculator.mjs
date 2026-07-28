// SYS-01 — Client Value Calculator.
// Source: GHL-System-Map.md DECISION & PROGRESS CONTROL section (counted as part of
// the DPC-Series' 7).
// An internal projection metric (not a real invoice/payment — Rule about touching
// money is about real dollar amounts reaching a client or a payout; this is
// analytics), with an explicit, unambiguous formula (unlike F-07/AF-04's
// unspecified commission math), so it's built directly:
//   potential_value = total_approved_amount * funding_fee_percent, if a round has
//   been approved; otherwise falls back to the analyzer's pre-qualification estimate.
//
// Trigger: round.approved (falls back to decision.rendered's estimate when no
// approved amount exists yet, e.g. before any round is submitted).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // 05/30 doc lines 3704-3711 apply "Multiply by Funding Fee Percent" on BOTH branches —
  // the result is a COMMISSION estimate (line 3714), not a capital figure. The fallback
  // here returned the raw funding estimate, overstating client value by ~10x at a
  // typical 10% fee. Both branches now multiply.
  const { approvedAmount, feePercent, fundingEstimate } = event.payload || {};
  const basis = approvedAmount ?? fundingEstimate ?? null;
  if (basis == null || feePercent == null) return { done: false, reason: "no_basis_for_estimate" };
  const potentialCommission = basis * (feePercent / 100);

  // Field name is the doc's: cf_potential_commission (lines 3706, 3710, 5046). This wrote
  // `potential_value`, which nothing else in the system reads.
  await step.run("set-potential-commission", () =>
    mergeCustomFields(db, clientId, { potential_commission: potentialCommission }));
  return { done: true, potentialCommission };
}

export const sys01ClientValueCalculator = inngest.createFunction(
  { id: "sys-01-client-value-calculator", name: "SYS-01 — Client Value Calculator" },
  { event: "round.approved" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
