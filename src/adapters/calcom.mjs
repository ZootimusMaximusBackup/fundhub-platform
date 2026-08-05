// Cal.com booking adapter — Master Rebuild Spec Phase 1.
//
// Adapter responsibilities (only these, nothing else):
//   1. Verify the webhook signature (fail-closed).
//   2. Normalize the raw body into a flat event.
//   3. Emit canonical events onto the bus — handlers registered elsewhere react.
//
// Cal.com signature: X-Cal-Signature-256 = hex HMAC-SHA256(rawBody, secret).
// No prefix variants documented in the Cal.com spec — accept raw hex only.

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";

// --- 1. Signature verification (fail-closed) --------------------------------
// Returns false on any mismatch / missing / no-secret — caller MUST refuse.
export function verifyCalcomSignature(rawBody, header, secret) {
  if (!secret) return false;
  const provided = String(header || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Cal.com shape: { triggerEvent, payload: { uid, startTime, endTime, attendees, organizer, eventType } }
function pickMeetingUrl(p) {
  const meta = p.metadata || {};
  const candidates = [meta.videoCallUrl, meta.meetingUrl, p.location, p.meetingUrl];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}

export function normalizeCalcomEvent(body) {
  const b = body || {};
  const p = b.payload || {};
  const attendees = Array.isArray(p.attendees) ? p.attendees : [];
  const first = attendees[0] || {};

  return {
    triggerEvent: String(b.triggerEvent || "").toUpperCase(),
    bookingUid: String(p.uid || ""),
    startTime: p.startTime || null,
    endTime: p.endTime || null,
    email: String(first.email || "").trim().toLowerCase(),
    name: String(first.name || "").trim(),
    meetingUrl: pickMeetingUrl(p),
    rescheduleUid: p.rescheduleUid || p.rescheduledBy || null
  };
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// BOOKING_CREATED → booking.created (the booking exists at this time).
// BOOKING_RESCHEDULED → also booking.created (pragmatic choice: a reschedule means
//   a booking now exists at a new time; the consumer sees the current slot, not the
//   delta. Treat it identically to a new booking rather than inventing a new name).
// Everything else → [] (no emit).
export function mapToCanonical(evt) {
  if (!evt) return [];
  const trigger = String(evt.triggerEvent || "");
  if (trigger === "BOOKING_CREATED") return [{ name: "booking.created" }];
  if (trigger === "BOOKING_RESCHEDULED") return [{ name: "booking.rescheduled" }];
  if (trigger === "BOOKING_CANCELLED") return [{ name: "booking.cancelled" }];
  if (trigger === "BOOKING_NO_SHOW" || trigger === "MEETING_NO_SHOW" || trigger === "BOOKING_NO_SHOW_CREATED") {
    return [{ name: "booking.noshow" }];
  }
  return [];
}

// --- Adapter entrypoint -----------------------------------------------------
// handleCalcomWebhook({ db, rawBody, signatureHeader, secret })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Idempotency key = calcom:<bookingUid>:<canonicalName> so re-delivered webhooks
// are safe no-ops and two distinct triggers on the same uid each get their own key.
export async function handleCalcomWebhook({ db, rawBody, signatureHeader, secret }) {
  if (!verifyCalcomSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }

  const evt = normalizeCalcomEvent(body);
  const canonical = mapToCanonical(evt);

  if (canonical.length === 0) {
    return { ok: true, status: 200, reason: `ignored:${evt.triggerEvent || "unknown"}`, emitted: [] };
  }

  if (!evt.email) {
    return { ok: true, status: 200, reason: "no_email", emitted: [] };
  }

  const emitted = [];
  for (const c of canonical) {
    const payload = {
      bookingUid: evt.bookingUid,
      startTime: evt.startTime,
      endTime: evt.endTime,
      email: evt.email,
      name: evt.name,
      meetingUrl: evt.meetingUrl,
      rescheduleUid: evt.rescheduleUid,
      source: "calcom"
    };
    const idKey = evt.bookingUid ? `calcom:${evt.bookingUid}:${c.name}` : undefined;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted };
}
