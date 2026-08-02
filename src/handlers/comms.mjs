// Comms + booking handlers — Master Rebuild Spec Phase 2 (reactions layer, batch 2).
//
// The journey-spine handlers live in client-lifecycle.mjs; these cover the
// communication + scheduling side events:
//   message.inbound (Twilio SMS, and Mailgun email from a client's own address)
//                                 -> messages row (inbound, channel off the payload)
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
//
// THREADING. The two handlers that write `messages` also maintain the client's
// `conversations` row for that channel and fill in messages.conversation_id.
// Until now both were left NULL, so the conversations table, idx_messages_convo
// and fk_messages_convo all existed with nothing on either end. The writer lives
// in src/conversations/store.mjs; see threadMessage() below for why it swallows
// its own failures and where last_pulse_at comes from. Nothing here writes
// `sentiment` — no code in this repo computes Hot/Warm/Cold.

import { on } from "../events/registry.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { recordOptOut, recordOptIn } from "../lib/opt-out.mjs";
import { createTask } from "../lib/create-task.mjs";
import { upsertConversation, linkMessage } from "../conversations/store.mjs";

// TCPA standard opt-out and opt-in keyword sets (case-insensitive, trimmed).
const STOP_KEYWORDS  = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

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

/* THREADING — messages.conversation_id used to be left NULL by both writers
   below, so `conversations`, `idx_messages_convo` and fk_messages_convo all
   existed with nothing on either end of them. These two helpers close that.

   THE MESSAGE ROW IS THE SOURCE OF THE PULSE TIME. Neither the Twilio nor the
   Bland payload carries a timestamp — normalizeTwilioEvent yields
   {from,to,body,sid,...} and Bland's yields {callId,status,disposition,
   durationSec,transferred} — so last_pulse_at comes from the messages row's own
   created_at, returned by the INSERT. That is a real recorded fact rather than
   a new Date() invented at handler time, and on the dedupe path it stays the
   ORIGINAL message's time instead of drifting forward on every redelivery.

   FAILURE HERE MUST NOT LOSE THE MESSAGE. The messages row is the record of
   what a client actually said; the conversation row is an index over it. If the
   thread write fails, the message insert has already committed and must stay
   committed, so this logs and swallows rather than throwing back into dispatch()
   — a throw would dead-letter an event whose primary work succeeded, and a
   retry of it would then re-run the whole handler. */

// The already-stored row behind a provider_ref, for the ON CONFLICT DO NOTHING
// path where the INSERT returns no row because the message is a redelivery.
async function findMessageByRef(db, orgId, providerRef) {
  if (!providerRef) return null;
  const r = await db.query(
    `SELECT id, created_at FROM messages WHERE org_id=$1 AND provider_ref=$2 LIMIT 1`,
    [orgId, providerRef]
  );
  return r.rows[0] || null;
}

// Upsert the (client, channel) thread and point the message at it.
// `channel` is passed in by the caller as the exact value it wrote to
// messages.channel — no parallel vocabulary is minted here.
async function threadMessage(db, { orgId, clientId, channel, inserted, providerRef }) {
  // conversations.client_id is NOT NULL, and these handlers deliberately do not
  // mint a client from an inbound message (it could be spam). An SMS from an
  // unrecognised number therefore has no thread to join; it stays a messages row
  // with conversation_id NULL, which is the honest state, not a bug.
  if (!clientId) return null;
  try {
    const message = inserted || (await findMessageByRef(db, orgId, providerRef));
    if (!message) return null;
    // summary is not passed: no payload here carries one, and sentiment is never
    // written at all — see the header of src/conversations/store.mjs.
    const convo = await upsertConversation(db, {
      orgId,
      clientId,
      channel,
      lastPulseAt: message.created_at || null
    });
    await linkMessage(db, { messageId: message.id, conversationId: convo.id });
    return convo;
  } catch (err) {
    console.error(
      `[comms] conversation threading failed for ${channel} message ` +
      `(provider_ref=${providerRef || "none"}): ${err && err.message}`
    );
    return null;
  }
}

// message.inbound — a client contacting us. SMS from Twilio, or email from
// Mailgun when the From address matches a client record (see the note at the
// bottom of handleMailgunWebhook). Link to the client if known.
// Handles TCPA STOP/START keywords before logging the message row.
//
// CHANNEL-DRIVEN, NOT SMS-WITH-EXCEPTIONS. `channel` has been read off the
// payload since this handler was written; what follows now honours it in the
// two places that were still assuming a text:
//
//   the client lookup — `from` is a phone number on sms and an email address on
//     email, and asking `WHERE phone = 'someone@example.com'` matches nothing.
//     The adapter resolves the client itself and passes it as event.clientId, so
//     this is the fallback path rather than the usual one, but a fallback that
//     silently cannot succeed is worse than no fallback: it turns a resolvable
//     client into an unthreaded message with no error anywhere.
//
//   the subject — email has one and SMS does not. It is stored on the row
//     (111_messages_address) so the thread can show what the client's reply was
//     about, which for an email is frequently the only thing above the fold.
//
// The STOP/START branch is unchanged and still guarded on sms. An email is not
// a TCPA text message and its words are not opt-out keywords.
export async function onMessageInbound(event, db) {
  const p = event.payload || {};
  const channel = p.channel || "sms";
  const clientId = event.clientId || (await findClient(db, event.orgId,
    channel === "email" ? { email: p.from } : { phone: p.from }));
  const word = String(p.body || "").trim().toUpperCase();
  const providerRef = p.sid || null;
  if (clientId && channel === "sms") {
    if (STOP_KEYWORDS.has(word)) {
      await recordOptOut(db, clientId, event.orgId, "sms", "inbound_keyword");
    } else if (START_KEYWORDS.has(word)) {
      await recordOptIn(db, clientId, "sms");
    }
  }
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status, subject)
     VALUES ($1,$2,'inbound',$3,$4,$5,$6,'received',$7)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    // NULL on SMS, which has no subject — not an empty string. The schema-wide
    // rule is that NULL means "there isn't one" and must survive.
    [event.orgId, clientId, channel, p.body || null, p.source || "twilio", providerRef,
     channel === "email" ? (p.subject || null) : null]
  );
  await threadMessage(db, {
    orgId: event.orgId,
    clientId,
    channel,
    inserted: (ins.rows || [])[0] || null,
    providerRef
  });
}

// call.completed — a finished Bland voice call. Logged as a voice message row.
export async function onCallCompleted(event, db) {
  const p = event.payload || {};
  const clientId = event.clientId || null;
  const providerRef = p.callId || null;
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,$2,'outbound','voice',$3,$4,$5,$6)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [event.orgId, clientId, p.disposition || null, p.source || "bland", providerRef, p.status || "completed"]
  );
  await threadMessage(db, {
    orgId: event.orgId,
    clientId,
    // 'voice' is the literal this handler already writes to messages.channel.
    channel: "voice",
    inserted: (ins.rows || [])[0] || null,
    providerRef
  });
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
  // Routed to closer: a booked strategy session is a sales call, and the closer
  // takes it. This was the last task writer still creating work with no owner —
  // it is not a workflow, so it was outside the 19 the routing pass covered.
  await createTask(db, {
    orgId: event.orgId,
    clientId,
    title: "Strategy session booked",
    sourceWorkflow: "calcom",
    assigneeRole: "closer",
    dueAt: p.startTime || null,
    eventId: uid
  });
}

export function register() {
  on("message.inbound", onMessageInbound);
  on("call.completed", onCallCompleted);
  on("mail.response", onMailResponse);
  on("booking.created", onBookingCreated);
}
