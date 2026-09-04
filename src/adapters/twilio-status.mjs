// Twilio delivery-status callback adapter — the CRM cutover Ticket 2.
//
// This is the RETURN PATH, and it is a different webhook from the inbound SMS
// one in twilio.mjs. Twilio POSTs here after it has tried to deliver a message
// WE sent, so the only thing it can tell us about is a row that already exists.
// It carries no body text and creates nothing.
//
// Fields Twilio sends (application/x-www-form-urlencoded):
//   MessageSid    — THEIR id, handed back when they accepted the send. This is
//                   what we stored in messages.provider_message_id.
//   MessageStatus — queued | sending | sent | delivered | undelivered | failed
//   ErrorCode     — present on undelivered/failed only.
//
// Signature scheme is identical to the inbound webhook (HMAC-SHA1 over the full
// URL plus sorted params), so verification is imported rather than re-written —
// two copies of a signature check is two places for one of them to rot.

import { verifyTwilioSignature, normalizeTwilioEvent } from "./twilio.mjs";

/* Twilio's vocabulary → ours.

   `sent` and `delivered` are NOT the same event and the distinction is the
   whole point of this callback: `sent` means the carrier took it, `delivered`
   means a handset acknowledged it. A row that stops at `sent` is a message that
   may never have arrived.

   The in-flight states (queued, sending, accepted) are deliberately absent. They
   carry no information we do not already have — the row is already `queued` —
   and mapping them would let a late-arriving `sending` callback overwrite a
   `delivered` that landed first. */
export const STATUS_MAP = {
  delivered: "delivered",
  undelivered: "failed",
  failed: "failed",
  sent: "sent"
};

/* The states we acknowledge and ignore. Named explicitly rather than caught by
   an else-branch, so an unrecognised Twilio status is distinguishable from one
   we chose to skip. */
export const IGNORED_STATUSES = new Set(["queued", "sending", "accepted", "scheduled"]);

export function normalizeStatusEvent(rawBody) {
  const evt = normalizeTwilioEvent(rawBody);
  const p = evt._params || {};
  return {
    sid: evt.sid,
    status: (p.MessageStatus || "").trim().toLowerCase(),
    errorCode: p.ErrorCode || null,
    errorMessage: p.ErrorMessage || null,
    _params: p
  };
}

/* Operator-facing error text. Twilio gives a numeric code and sometimes a
   sentence; keep both, keep it short, and never let a provider payload grow
   without bound in a column an operator reads. */
function errorText(evt) {
  if (!evt.errorCode && !evt.errorMessage) return null;
  const parts = [];
  if (evt.errorCode) parts.push(`twilio_error_${evt.errorCode}`);
  if (evt.errorMessage) parts.push(String(evt.errorMessage));
  return parts.join(": ").slice(0, 300);
}

/**
 * handleTwilioStatusWebhook({ db, rawBody, signatureHeader, secret, url })
 *   → { ok, status, updated, messageStatus?, reason? }
 *
 * `updated` is the number of message rows moved. It is returned rather than
 * logged because "exactly one row moved" is the property this endpoint has to
 * hold, and a caller that cannot see the count cannot assert it.
 */
export async function handleTwilioStatusWebhook({ db, rawBody, signatureHeader, secret, url }) {
  const evt = normalizeStatusEvent(rawBody);

  // Fail-closed, before anything is read or written. An unsigned status callback
  // is an unauthenticated stranger claiming a message of ours failed.
  if (!verifyTwilioSignature(url, evt._params, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", updated: 0 };
  }

  if (!evt.sid) {
    return { ok: true, status: 200, reason: "not_a_status_callback", updated: 0 };
  }

  if (IGNORED_STATUSES.has(evt.status)) {
    return { ok: true, status: 200, reason: "in_flight", updated: 0, messageStatus: evt.status };
  }

  const mapped = STATUS_MAP[evt.status];
  if (!mapped) {
    // An unknown status is NOT treated as a failure. Guessing here would let a
    // vocabulary change at Twilio silently mark live messages dead.
    return { ok: true, status: 200, reason: "unknown_status", updated: 0, messageStatus: evt.status };
  }

  /* Matched on provider_message_id — THEIRS — and never on provider_ref, which
     is ours and which Twilio has never seen. The direction and channel guards
     are not decoration: provider_message_id is not unique-indexed, so without
     them a colliding id from another channel could move a row this callback has
     no business touching.

     `attempts` and `blocked_*` are untouched on purpose. A delivery receipt is
     not an attempt, and nothing in the return path may clear a compliance
     block — 110's own comment says those columns are written and never cleared. */
  const r = await db.query(
    `UPDATE messages
        SET status = $2,
            last_error = COALESCE($3, last_error),
            updated_at = now()
      WHERE provider_message_id = $1
        AND direction = 'outbound'
        AND channel = 'sms'`,
    [evt.sid, mapped, errorText(evt)]
  );

  const updated = r.rowCount ?? 0;
  if (updated === 0) {
    /* A receipt for a message we have no record of. Acknowledged with 200 so
       Twilio stops retrying, but reported as unmatched rather than as success —
       a silent 200 here is how a broken provider_message_id write upstream stays
       invisible for weeks. */
    return { ok: true, status: 200, reason: "unmatched", updated: 0, messageStatus: mapped };
  }

  return { ok: true, status: 200, updated, messageStatus: mapped };
}
