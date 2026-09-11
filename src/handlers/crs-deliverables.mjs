// The five UnderwriteIQ deliverables, produced in-process when the credit file
// lands. F42, fixed 2026-09-04.
//
// COMPLIANCE REVIEW REQUIRED — credit-repair messaging and projected-score
// adjacent. Marker only.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// C-06 (../workflows/c-06-crs-results-router.mjs) is the only producer of the
// funding pack, and it is an Inngest function. Between 2026-08-04 and
// 2026-09-03 four `analysis.completed` events were written and ZERO deliverable
// documents were ever created, for any client, in production — while every gate
// inside C-06's handle() was provably open.
//
// Running the whole path locally against a scratch Postgres (the same
// scripts/sim/push-credit.mjs profile the walkthrough used) settles which half
// is broken: handle() reaches deliver-funding-letters, buildLetterPackForClient
// returns five files, and persistFundingLetterFiles writes the rows. The
// producing half works. What never happened is the INVOCATION — the Inngest
// fan-out at ../events/bus.mjs:49-53 is `void inngest.send(...).catch(() => {})`,
// fire-and-forget with the rejection swallowed, so a failed hand-off leaves no
// trace anywhere and C-06 simply never runs.
//
// So the deliverables stop depending on a second engine waking up. This is the
// same rule and the same shape as ./diagnostic-soft-pull.mjs, which exists for
// exactly this reason on the pull itself: "the CRM must update when the bytes
// land, not when a separate engine wakes up."
//
// ── WHY IT IS SAFE TO RUN TWICE ─────────────────────────────────────────────
// It reuses C-06's own handle(), so there is one code path, one set of gates and
// one idempotency key. deliverFundingLettersOnce stamps
// clients.custom_fields.funding_letters_delivered_event_id with the event id;
// the bus hands the SAME events-row id to the local dispatch and to Inngest
// (bus.mjs:49-53 sends `data: { id, ... }`, and src/workflows/index.mjs passes
// event.data straight through). So whichever fires first delivers and the other
// is a no-op. Nothing is written twice.
//
// ── COST ────────────────────────────────────────────────────────────────────
// Measured 2026-09-04 on the academy profile against local Postgres 16: 2.0
// seconds to build and store all five documents. It runs inside emit(), which
// runs inside src/finance/crs-pull.mjs finishStored — already behind a bureau
// call. A throw here is caught and dead-lettered by the bus (bus.mjs dispatch),
// so a failure leaves a durable row instead of vanishing, and it can never take
// the pull down with it.

import { on } from "../events/registry.mjs";
import { handle as runC06 } from "../workflows/c-06-crs-results-router.mjs";

/** The bus is synchronous; C-06's steps are plain function calls here. */
function syncStep() {
  return { run: async (_name, fn) => fn() };
}

export async function onAnalysisCompletedDeliverables(event, db) {
  if (event?.payload?.source !== "crs") return { done: false, reason: "not_crs_source" };
  if (!event?.orgId) return { done: false, reason: "no_org" };
  return runC06({ event, db, step: syncStep() });
}

export function register() {
  on("analysis.completed", onAnalysisCompletedDeliverables);
}
