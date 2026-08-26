// contract.signed — the first thing that has ever listened to a signature.
//
// COMPLIANCE REVIEW REQUIRED: consent capture. One of the four documents this
// reacts to is SOFT-PULL-CONSENT, and anything that reads a signature on a
// consumer-credit authorization is compliance-flagged by CLAUDE.md §7 whether or
// not it writes a consent record. This one does NOT write one — see below.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT WAS BROKEN
//
// src/contracts/sign.mjs completes a contract, builds the signed PDF, registers
// it as a document, and emits contract.signed with the org id, the client id and
// the template key all correctly populated. `grep -rn 'on("contract' src/`
// returned NOTHING. The event landed in a table and stopped there: the badge
// said SIGNED and no person, screen or document ever moved.
//
// The signed PDF is the visible half of it. src/contracts/send.mjs marks the
// UNSIGNED copy delivered the moment it registers it (send.mjs:390-396,
// channel 'portal', status 'sent'). The SIGNED copy, registered in
// sign.mjs:458-476, got no such line — so every countersigned file in the
// system sits at delivery_status = 'not_delivered' forever, and a "what did we
// actually give this client" audit over documents/ reads as though they never
// got their copy.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS DOES, AND WHY IT IS ONLY THIS MUCH
//
//   1. Marks the signed document delivered — channel 'portal', status 'sent'.
//      Exactly the line send.mjs already runs for the unsigned copy, and true
//      for the same reason: nothing is transmitted, the client fetches it from
//      the link they already have. sign.mjs:262-265 serves the SIGNED bytes
//      through that same link the moment the contract reaches 'signed', so the
//      copy really is theirs to collect at the point this runs.
//
//   2. Puts ONE task in front of a person, so a signature is not invisible to
//      the team. Routed by the rule the contract feature already uses for its
//      own work: to whoever pressed Send (contracts.sent_by), owned by the
//      closer queue when we do not know. That rule is copied verbatim from
//      chaseContracts() in src/contracts/notify.mjs — it is not a new one.
//
// WHAT IT DELIBERATELY DOES NOT DO. Each of these needs a decision nobody has
// recorded, and guessing one here would write it into the product by accident:
//
//   * NO CONSENT ROW. A signed SOFT-PULL-CONSENT is a contract. The soft-pull
//     gate reads a consent record instead (src/finance/soft-pulls.mjs:306,
//     kind 'soft_pull_consent'), captured through POST /api/consent/capture.
//     Two writers for one permission is how a revocation stops biting, so this
//     handler stays out of that path entirely.
//
//   * NO ENTITLEMENT UNLOCK. product_entitlements is empty in every migration
//     and db/migrations/032_entitlements.sql:36-47 says in terms that which
//     product grants which entitlement is not recorded anywhere in this repo.
//     There is also no mapping from an offer key to a products.code. A grant
//     from here would be an invented offer decision.
//
//   * NO STAGE MOVE. db/seed/002_pipelines.sql has no "contract signed" stage
//     on any pipeline. The nearest, sales/closed_won, is "Closed Won (deposit)"
//     — a payment, not a signature. Nothing to advance to that would be honest.
//
//   * NO CUSTOMER-FACING MESSAGE. The only two contract emails that exist say
//     "Please sign" and "Still waiting on your signature" (db/seed/008). Mailing
//     either to somebody who has just signed would be wrong and confusing, and
//     writing new consumer copy is not something a handler gets to do.
//
// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENT (Rule 9). Signing replays and this must not double-write:
//   * emit() dedupes on `contract.signed:<contractId>`, so one event per
//     contract ever reaches the bus.
//   * markDelivered() only moves delivery forward (canTransitionDelivery), so a
//     replayed 'sent' writes nothing and reports updated: false.
//   * createTask() dedupes on (client_id, source_workflow, body), and the body
//     below is built only from frozen columns — the contract id, the title, the
//     signer name and signed_at, none of which change after completion.
// Errors are NOT swallowed: every write here is idempotent, so letting a real
// failure reach the bus records it on the dead-letter queue and keeps it
// retryable. Absorbing it would lose the work quietly instead.

import { on } from "../events/registry.mjs";
import { markDelivered } from "../documents/register.mjs";
import { createTask } from "../lib/create-task.mjs";

/** Where this handler's work is filed, and who owns it. */
export const SIGNED_WORKFLOW = "contract-signed";
export const SIGNED_TASK_ROLE = "closer";

/* Plain-language names for the documents this platform sends, keyed by the
   template keys in src/config/offers.mjs (contractTemplateKey) plus the tier
   key resolveContractTemplateKey() returns for FUNDING_PLUS_REPAIR. These are
   WORDING ONLY — no branch here changes what is written, for the reasons in the
   header. A key that is not on this list is a custom or uploaded contract and
   gets no invented description. */
export const CONTRACT_LABELS = Object.freeze({
  "SOFT-PULL-CONSENT": "soft-pull consent",
  "FUNDING-AGREEMENT": "funding agreement",
  "CREDIT-REPAIR-AGREEMENT": "credit repair agreement",
  "REPAIR-TRIAL-AGREEMENT": "repair test-run agreement",
  "REPAIR-AND-FUNDING-AGREEMENT": "repair and funding agreement",
  "FUNDING-MASTERY-AGREEMENT": "Funding Mastery program agreement"
});

/** The one branch: template key → plain words, or null when we do not know. */
export function describeContract(templateKey) {
  const key = String(templateKey ?? "").trim().toUpperCase();
  return CONTRACT_LABELS[key] || null;
}

/* Only what this handler needs. rendered_body is deliberately absent — the
   words of a consumer's signed agreement have no business in a handler. */
const SIGNED_COLUMNS = `
  id, org_id, client_id, template_key, title, status, sent_by,
  signed_at, signer_name, signed_document_id, signed_document_version_id`;

/**
 * loadSignedContract — the row behind the event.
 *
 * The event payload carries `document_id`, which is the copy that was SENT.
 * The signed copy is a second documents row and its id is only on the contract
 * (signed_document_id), so the row has to be read. Org-scoped: an event naming
 * another company's contract must find nothing.
 */
export async function loadSignedContract(db, { orgId, contractId } = {}) {
  if (!orgId || !contractId) return null;
  const { rows } = await db.query(
    `SELECT ${SIGNED_COLUMNS} FROM contracts
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [contractId, orgId]
  );
  return rows[0] || null;
}

/**
 * deliverSignedCopy — record that the countersigned file is theirs to collect.
 *
 * Returns { delivered, reason }. `delivered: false` with reason 'no_transition'
 * is the normal answer on a replay and is not a failure.
 *
 * A contract whose signed PDF could not be built has signed_document_id NULL —
 * sign.mjs:478-486 catches a failed render and completes the contract anyway,
 * on purpose. There is nothing to hand over in that case and saying so is the
 * honest answer.
 */
export async function deliverSignedCopy(db, contract) {
  if (!contract || !contract.signed_document_id) {
    return { delivered: false, reason: "no_signed_document" };
  }
  const res = await markDelivered(db, {
    documentId: contract.signed_document_id,
    versionId: contract.signed_document_version_id || null,
    channel: "portal",
    status: "sent",
    // When they got it, not when this ran — so a replay cannot move the date.
    deliveredAt: contract.signed_at || null
  });
  return { delivered: res.updated === true, reason: res.reason || null };
}

/** A date a person can read, or null. Never a guessed one. */
function dayOf(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function onContractSigned(event, db) {
  const orgId = event?.orgId || null;
  const p = event?.payload || {};
  const contractId = p.contract_id || null;
  if (!orgId || !contractId) return { done: false, reason: "no_contract" };

  const contract = await loadSignedContract(db, { orgId, contractId });
  if (!contract) return { done: false, reason: "contract_not_found" };

  const delivery = await deliverSignedCopy(db, contract);

  /* NO CLIENT, NO TASK. createTask's early dedupe check compares
     client_id = $1, which never matches on NULL; only the unique index
     (db/schema/006_tasks_idempotency.sql, NULLS NOT DISTINCT) would then absorb
     the second write, and leaning on a database index to cover a replay is not
     a guarantee this handler should be making about itself. Unassignable work
     reaching nobody is also the exact failure createTask was written to stop.
     contracts.client_id is NOT NULL (124_contracts.sql:137), so this is a
     malformed-event guard, not an expected path. */
  const clientId = contract.client_id || event?.clientId || p.client_id || null;
  if (!clientId) return { done: false, reason: "no_client", delivery };

  const label = describeContract(contract.template_key || p.template_key);
  const who = String(contract.signer_name || "").trim() || "The client";
  const day = dayOf(contract.signed_at);

  const body = [
    `${who} signed "${contract.title}"${label ? ` (${label})` : ""}${day ? ` on ${day}` : ""}.`,
    contract.signed_document_id
      ? "The signed copy is saved and opens from the same link they used to sign."
      : "NO SIGNED FILE WAS PRODUCED for this one — the signature is on record, "
        + "but there is no countersigned copy to hand over. Check it before you promise one.",
    `Contract ${contract.id}.`
  ].join(" ");

  const task = await createTask(db, {
    orgId,
    clientId,
    title: `Contract signed: ${contract.title} — ${who}`,
    body,
    sourceWorkflow: SIGNED_WORKFLOW,
    assigneeRole: SIGNED_TASK_ROLE,
    assigneeStaffId: contract.sent_by || null
  });

  return {
    done: true,
    contractId: contract.id,
    clientId,
    templateKey: contract.template_key || null,
    label,
    delivery,
    task
  };
}

export function register() {
  on("contract.signed", onContractSigned);
}

export default register;
