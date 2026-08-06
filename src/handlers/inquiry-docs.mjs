// Doc-gate chase + flip for inquiry-removal cases.
//
// inquiry.docs.needed → tag + reuse F-06 missing-docs templates (existing chase).
// docs.received → re-check packet; last required doc flips Blocked → Queued
// and moves the card back to specialist_assigned.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { evaluateDocGate } from "../inquiry-ops/doc-gate.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { addTags, removeTags } from "../workflows/tags.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";

// Reuse F-06 copy — same "hound until they upload" behaviour, no new chase engine.
export const EMAIL_TEMPLATE_KEY = "EMAIL-F06-MISSING-DOCS";
export const SMS_TEMPLATE_KEY = "SMS-F06-MISSING-DOCS";

export async function onInquiryDocsNeeded(event, db) {
  const orgId = event.orgId;
  const clientId = event.clientId || (await resolveClient(db, event));
  if (!orgId || !clientId) return { done: false, reason: "missing_org_or_client" };

  await addTags(db, clientId, ["docs:missing", "inquiry:docs_needed"]);
  await mergeCustomFields(db, clientId, {
    employee_next_action: "Collect inquiry identity packet",
    inquiry_docs_missing: (event.payload?.missing || []).join(",")
  });

  const eventId = event.id || `inquiry-docs-${clientId}`;
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId: `${eventId}:email`
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId: `${eventId}:sms`
  });

  return { done: true, email, sms };
}

export async function onDocsReceivedFlipInquiryGate(event, db) {
  const orgId = event.orgId;
  const clientId = event.clientId || (await resolveClient(db, event));
  if (!orgId || !clientId) return { done: false, reason: "missing_org_or_client" };

  const blocked = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status = 'Blocked'::inquiry_case_status`,
    [orgId, clientId]
  );
  if (!blocked.rows.length) return { done: true, flipped: 0 };

  const packet = await evaluateDocGate(db, { orgId, clientId, items: [] });
  if (!packet.complete) {
    return { done: true, flipped: 0, complete: false, missing: packet.missing };
  }

  const ids = blocked.rows.map((r) => r.id);
  await db.query(
    `UPDATE inquiry_removal_cases
        SET case_status = 'Queued'::inquiry_case_status,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  await moveCardToStage(db, {
    orgId,
    clientId,
    pipelineKey: "inquiry_removal",
    stageKey: "specialist_assigned"
  });
  await removeTags(db, clientId, ["docs:missing", "inquiry:docs_needed"]);

  await emit(
    db,
    "inquiry.gate.raised",
    {
      clientId,
      bureaus: blocked.rows.map((r) => r.selected_bureaus_raw),
      caseIds: ids,
      reason: "docs_complete"
    },
    {
      orgId,
      clientId,
      idempotencyKey: `inquiry.gate.raised:docs:${clientId}:${ids.sort().join(",")}`
    }
  );

  return { done: true, flipped: ids.length, complete: true, caseIds: ids };
}

export function register() {
  on("inquiry.docs.needed", onInquiryDocsNeeded);
  on("docs.received", onDocsReceivedFlipInquiryGate);
}
