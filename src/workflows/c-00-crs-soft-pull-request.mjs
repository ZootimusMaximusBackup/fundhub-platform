// C-00 — CRS Soft Pull Request (Invoice/Consent -> Paid Gate -> Request -> Pull).
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
//
// 2026-08-07 — IT NOW ACTUALLY PULLS. Until today this workflow stamped
// "Requested" on the client and stopped, which meant a real $32 payment produced
// a status label and no credit report. It now does the three things that phrase
// was always supposed to mean, in this order and as separate steps:
//
//   1. records the request in the soft-pull ledger, which is where the consent
//      gate lives — requestSoftPull() refuses outright without valid consent;
//   2. asks CRS for the report;
//   3. lets the coordinator store it, close the ledger row and emit one event.
//
// THE ORDER IS THE POINT. The ledger write and the provider call are deliberately
// two steps rather than one: src/finance/soft-pulls.mjs says plainly that an
// outbound call inside the same await as the ledger insert makes "we recorded it"
// and "we asked for it" fail together, and the record has to survive a provider
// that is down.
//
// WHAT IT DOES NOT DO. It does not decide the outcome tier, it does not set
// crs_status to Complete — U-03 does that when the pull's event arrives — and it
// does not invent a status for a failed pull. A failure is recorded on the
// soft_pull_requests row with its reason, which is the honest record of it.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { requestSoftPull, SoftPullError } from "../finance/soft-pulls.mjs";
import { runCrsPull, CRS_PROVIDER, DIAGNOSTIC_PULL_REASON } from "../finance/crs-pull.mjs";

/* clientAccountId — the client's own portal account, for attribution.
   The ledger requires a requester and 077 gives it a foreign key per kind, so
   "the client, via the automation their payment triggered" has to resolve to a
   real accounts row. Ordered by created_at so a client with more than one row
   attributes to the same one every time rather than whichever the planner
   happened to return. */
export async function clientAccountId(db, clientId) {
  const res = await db.query(
    `SELECT id FROM accounts
      WHERE client_id = $1 AND kind = 'client'
      ORDER BY created_at
      LIMIT 1`,
    [clientId]
  );
  return res.rows[0]?.id ?? null;
}

export async function handle({ event, db, step, runPull = runCrsPull, env = process.env }) {
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

  /* NO ACCOUNT, NO PULL. An unattributed consumer-credit pull is exactly what
     the ledger exists to make impossible, and there is no 'system' requester
     kind to fall back on — 077's CHECK allows 'staff' or 'client' and nothing
     else. A client who paid but has never had a portal account created is a real
     gap; it is reported here rather than worked around. */
  const accountId = await step.run("find-client-account", () => clientAccountId(db, clientId));
  if (!accountId) {
    return { done: true, scope, pulled: false, reason: "no_account_for_attribution" };
  }

  let requested;
  try {
    requested = await step.run("request-soft-pull", () => requestSoftPull(db, {
      orgId: event.orgId,
      clientId,
      requestedBy: { kind: "client", id: accountId },
      reason: DIAGNOSTIC_PULL_REASON,
      /* NULL, NOT 3200. The $32 is what the client PAID for the diagnostic, not
         what the pull COST us, and 077 is explicit that a wrong number here ends
         up in a billing report nobody checks. Unknown stays unknown. */
      costCents: null,
      provider: CRS_PROVIDER,
      // One payment, one request, however many times the event is delivered.
      idempotencyKey: `diagnostic-paid:${event.id}`
    }));
  } catch (e) {
    /* The consent gate lands here. Refusing is the correct outcome, not an
       error to retry: no consent means no pull, and throwing would make Inngest
       try again on a condition only the client can change. */
    if (e instanceof SoftPullError) {
      return { done: true, scope, pulled: false, reason: e.code || "soft_pull_refused", detail: e.message };
    }
    throw e;
  }

  /* Not created means somebody already asked — a replayed payment event, or a
     pull already outstanding for this client. Neither should start a second
     order at the bureaus. */
  if (!requested.created) {
    return {
      done: true, scope, pulled: false,
      reason: requested.reason,
      requestId: requested.request?.id ?? null
    };
  }

  const pull = await step.run("run-crs-pull", () => runPull(db, {
    orgId: event.orgId,
    clientId,
    requestId: requested.request.id,
    env
  }));

  return {
    done: true,
    scope,
    pulled: !!pull.ok,
    requestId: requested.request.id,
    crsResultId: pull.crsResultId ?? null,
    bureausPulled: pull.bureausPulled ?? [],
    reason: pull.ok ? null : pull.code,
    detail: pull.ok ? null : pull.reason
  };
}

export const c00CrsSoftPullRequest = inngest.createFunction(
  { id: "c-00-crs-soft-pull-request", name: "C-00 — CRS Soft Pull Request" },
  { event: "diagnostic.paid" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
