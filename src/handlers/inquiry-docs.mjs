// Doc-gate chase + flip for inquiry-removal cases.
//
// inquiry.docs.needed → tag + DOC-01 chase (once).
// docs.received → if an active case still needs the identity packet, send
// DOC-01 once; last required doc flips Blocked → Queued.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { evaluateDocGate } from "../inquiry-ops/doc-gate.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { addTags, removeTags } from "../workflows/tags.mjs";
import { mergeCustomFields, claimCustomFieldLock } from "../workflows/custom-fields.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-DOC-01-REQUEST";
export const SMS_TEMPLATE_KEY = "SMS-DOC-01-REQUEST";
export const DOC_01_LOCK = "doc_01_request_sent_at";

const ACTIVE_CASE = ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"];

async function alreadySentDoc01(db, clientId) {
  const r = await db.query(
    `SELECT 1 FROM messages
      WHERE client_id = $1::uuid
        AND template_key IN ($2, $3)
      LIMIT 1`,
    [clientId, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY]
  );
  return r.rows.length > 0;
}

async function sendDoc01Once(db, { orgId, clientId, eventId, missing }) {
  if (await alreadySentDoc01(db, clientId)) return { sent: false, reason: "already_sent" };
  const claimed = await claimCustomFieldLock(db, clientId, DOC_01_LOCK);
  if (!claimed) return { sent: false, reason: "already_locked" };

  await addTags(db, clientId, ["docs:missing", "inquiry:docs_needed"]);
  await mergeCustomFields(db, clientId, {
    employee_next_action: "Collect inquiry identity packet",
    inquiry_docs_missing: (missing || []).join(",")
  });

  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId: `${eventId}:email`
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId: `${eventId}:sms`
  });
  return { sent: true, email, sms };
}

export async function onInquiryDocsNeeded(event, db) {
  const orgId = event.orgId;
  const clientId = event.clientId || (await resolveClient(db, event));
  if (!orgId || !clientId) return { done: false, reason: "missing_org_or_client" };

  const chase = await sendDoc01Once(db, {
    orgId,
    clientId,
    eventId: event.id || `inquiry-docs-${clientId}`,
    missing: event.payload?.missing || []
  });
  return { done: chase.sent === true, ...chase };
}

export async function onDocsReceivedFlipInquiryGate(event, db) {
  const orgId = event.orgId;
  const clientId = event.clientId || (await resolveClient(db, event));
  if (!orgId || !clientId) return { done: false, reason: "missing_org_or_client" };

  const active = await db.query(
    `SELECT id
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status::text = ANY($3::text[])`,
    [orgId, clientId, ACTIVE_CASE]
  );
  let chase = null;
  if (active.rows.length) {
    const packet = await evaluateDocGate(db, { orgId, clientId, items: [] });
    if (!packet.complete) {
      chase = await sendDoc01Once(db, {
        orgId,
        clientId,
        eventId: event.id || `inquiry-docs-${clientId}`,
        missing: packet.missing
      });
    }
  }

  const blocked = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND case_status = 'Blocked'::inquiry_case_status`,
    [orgId, clientId]
  );
  if (!blocked.rows.length) return { done: true, flipped: 0, chase };

  const packet = await evaluateDocGate(db, { orgId, clientId, items: [] });
  if (!packet.complete) {
    return { done: true, flipped: 0, complete: false, missing: packet.missing, chase };
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
