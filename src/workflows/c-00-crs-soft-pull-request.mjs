// C-00 — CRS Soft Pull Request (Invoice/Consent -> Paid Gate -> Request).
// Source: GHL-System-Map.md CREDIT OPS WORKFLOWS section.
// The original's Airtable webhook calls are NOT ported — Spec §6: the AX series
// (GHL<->Airtable mirroring) dissolves entirely with one database. Everything else
// (CRS status/scope bookkeeping) is ported as ordinary custom_fields writes.
//
// Trigger: diagnostic.paid (the $32 analyzer/CRS pull payment — Spec §4.2). Once
// paid, the CRS pull request is considered made: sets CRS Status=Requested, scope
// (personal vs business+personal, from the payload), Analyzer Path=Funding (this is
// the funding-track CRS request; a repair-track equivalent isn't distinguished in
// anything read for this port), Round Hold Reason=Awaiting CRS.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // Default consumer_only when businessScope absent — a real business-scope flag
  // must be set on the client record upstream before the diagnostic payment fires.
  const scope = event.payload?.businessScope ? "consumer_plus_ex_business" : "consumer_only";
  await step.run("set-crs-request-fields", () => mergeCustomFields(db, clientId, {
    crs_status: "Requested",
    crs_pull_scope: scope,
    analyzer_path: "Funding",
    round_hold_reason: "Awaiting CRS"
  }));

  return { done: true, scope };
}

export const c00CrsSoftPullRequest = inngest.createFunction(
  { id: "c-00-crs-soft-pull-request", name: "C-00 — CRS Soft Pull Request" },
  { event: "diagnostic.paid" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
