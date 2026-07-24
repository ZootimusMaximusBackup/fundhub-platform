// Comms + booking handlers — Master Rebuild Spec Phase 2 (reactions layer, batch 2).
//
// The journey-spine handlers live in client-lifecycle.mjs; these cover the
// communication + scheduling side events:
//   message.inbound (Twilio SMS)  -> messages row (channel=sms, inbound)
//   call.completed  (Bland voice) -> messages row (channel=voice, outbound)
//   mail.response   (Mailgun)     -> bank_inbox row (classified bank email)
//   booking.created (Cal.com)     -> tasks row (closer follow-up on the booking)
//
// Idempotent (Rule 9): messages dedupe on (org, provider_ref) via migration 004;
// bank_inbox + tasks self-dedupe with a guard SELECT keyed by the event id /
// booking uid, so replay() re-drives events without duplicating rows.
//
// resolveClient (create-if-missing by email) is reused from client-lifecycle for
// booking.created; the SMS/mail/voice handlers only LINK to an existing client
// (they must not mint a client from an inbound message — could be spam).

import { on } from "../events/registry.mjs";
import { resolveClient } from "./client-lifecycle.mjs";

// Non-creating lookup: match an existing client by email or phone. Returns id|null.
async function findClient(db, orgId, { email, phone } = {}) {
  if (!orgId) return null;
  const em = String(email || "").trim().toLowerCase();
  if (em) {
    const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2 LIMIT 1`, [orgId, em]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const ph = String(phone || "").trim();
  if (ph) {
    const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`, [orgId, ph]);
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

// message.inbound — inbound SMS (Twilio). Link to client by phone if known.
export async function onMessageInbound(event, db) {
  const p = event.payload || {};
  const clientId = event.clientId || (await findClient(db, event.orgId, { phone: p.from }));
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,$2,'inbound',$3,$4,$5,$6,'received')
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
    [event.orgId, clientId, p.channel || "sms", p.body || null, p.source || "twilio", p.sid || null]
  );
}

// call.completed — a finished Bland voice call. Logged as a voice message row.
export async function onCallCompleted(event, db) {
  const p = event.payload || {};
  const clientId = event.clientId || null;
  await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,$2,'outbound','voice',$3,$4,$5,$6)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING`,
    [event.orgId, clientId, p.disposition || null, p.source || "bland", p.callId || null, p.status || "completed"]
  );
}

// mail.response — a classified bank email (Mailgun). Deduped by event id in raw.
export async function onMailResponse(event, db) {
  const p = event.payload || {};
  const clientId = event.clientId || (await findClient(db, event.orgId, { email: p.from }));
  const dup = await db.query(
    `SELECT 1 FROM bank_inbox WHERE org_id=$1 AND raw->>'__event_id'=$2 LIMIT 1`,
    [event.orgId, String(event.id)]
  );
  if (dup.rows[0]) return;
  const raw = { ...p, __event_id: event.id };
  await db.query(
    `INSERT INTO bank_inbox (org_id, client_id, classification, subject, body_preview, raw)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [event.orgId, clientId, p.classification || null, p.subject || null, p.subject || null, JSON.stringify(raw)]
  );
}

// booking.created — a scheduled call (Cal.com). Client is a known lead → resolve
// (create-if-missing). Creates a closer follow-up task, deduped by (client, uid).
export async function onBookingCreated(event, db) {
  const clientId = await resolveClient(db, event);
  if (!clientId) return;
  const p = event.payload || {};
  const uid = p.bookingUid || null;
  const dup = await db.query(
    `SELECT 1 FROM tasks WHERE client_id=$1 AND source_workflow='calcom' AND body=$2 LIMIT 1`,
    [clientId, uid]
  );
  if (uid && dup.rows[0]) return;
  await db.query(
    `INSERT INTO tasks (org_id, client_id, title, body, due_at, source_workflow)
     VALUES ($1,$2,$3,$4,$5,'calcom')`,
    [event.orgId, clientId, "Strategy session booked", uid, p.startTime || null]
  );
}

export function register() {
  on("message.inbound", onMessageInbound);
  on("call.completed", onCallCompleted);
  on("mail.response", onMailResponse);
  on("booking.created", onBookingCreated);
}
