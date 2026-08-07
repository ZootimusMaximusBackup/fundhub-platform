// ClickFunnels webhook adapter — lead capture, survey submission, appointments.
//
// ClickFunnels is the funnel front-end. This adapter translates opt-in / form
// submissions into canonical bus events so downstream handlers (GHL contact
// creation, Airtable, email journey triggers) react without coupling to CF.
//
// ┌────────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM payload paths against a real ClickFunnels webhook.               │
// │ CF Classic and CF 2.0 differ. Classic: contact at top-level or data.contact │
// │ with snake_case fields. 2.0: contact nested under data.contact with         │
// │ camelCase + snake_case variants. Survey answers: CF Classic stores them in  │
// │ contact.survey_answers or data.survey_answers. CF 2.0 may use               │
// │ data.formData, data.answers, or contact.custom_fields. Paths below are      │
// │ best-effort from CF docs + community payloads — adjust normalizeClickFunnelsEvent(). │
// └────────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit } from "../events/bus.mjs";

// --- 1. Signature verification (fail-closed) --------------------------------
// ClickFunnels signs with HMAC-SHA256 of the raw body. Some versions prefix the
// header with "sha256=". Mirrors verifyCommasSignature exactly. Returns false on
// any mismatch / missing input — caller MUST refuse when false.
export function verifyClickFunnelsSignature(rawBody, header, secret) {
  if (!secret) return false;
  const provided = String(header || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// Appointment webhook types (ClickFunnels booking calendar — not Cal.com).
const APPOINTMENT_CREATED = "appointments/scheduled_event.created";
const APPOINTMENT_RESCHEDULED = "appointments/scheduled_event.rescheduled";
const APPOINTMENT_CANCELED = "appointments/scheduled_event.canceled";

function isAppointmentType(type) {
  return (
    type === APPOINTMENT_CREATED ||
    type === APPOINTMENT_RESCHEDULED ||
    type === APPOINTMENT_CANCELED
  );
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Reads defensively from CF Classic + 2.0 shapes. Returns null when no usable
// data is found (caller treats as no-op).
export function normalizeClickFunnelsEvent(body) {
  const b = body || {};

  // CF 2.0 wraps everything under `data`; Classic may have a top-level contact.
  const d = (b.data && typeof b.data === "object" ? b.data : null) || b;

  // Event type / hook type (needed before contact pick — appointments use
  // data.primary_contact, not data.contact).
  const type = String(
    b.type ||
    b.event ||
    b.event_type ||
    b.hook ||
    d.type ||
    d.event ||
    d.event_type ||
    ""
  ).toLowerCase();

  // Contact block: appointments → data.primary_contact; otherwise CF Classic /
  // 2.0 contact shapes.
  const primary =
    d.primary_contact && typeof d.primary_contact === "object" ? d.primary_contact : null;
  const contact =
    (isAppointmentType(type) && primary) ||
    (d.contact && typeof d.contact === "object" ? d.contact : null) ||
    (b.contact && typeof b.contact === "object" ? b.contact : null) ||
    primary ||
    d ||
    b;

  // Email — most critical field.
  const email = String(
    contact.email ||
    contact.email_address ||
    d.email ||
    d.email_address ||
    b.email ||
    ""
  ).trim().toLowerCase();

  // Name: prefer full_name, fall back to first+last concat.
  const firstName = contact.first_name || contact.firstName || d.first_name || b.first_name || "";
  const lastName = contact.last_name || contact.lastName || d.last_name || b.last_name || "";
  const name = String(
    contact.full_name ||
    contact.fullName ||
    d.full_name ||
    b.full_name ||
    (firstName || lastName ? `${firstName} ${lastName}`.trim() : "")
  ).trim();

  // Phone: several CF field names in use.
  const phone = String(
    contact.phone ||
    contact.phone_number ||
    contact.phoneNumber ||
    d.phone ||
    d.phone_number ||
    b.phone ||
    ""
  ).trim();

  // Funnel name / page name for tracing. Appointments: event_type.name.
  const eventTypeName =
    (d.event_type && typeof d.event_type === "object" && d.event_type.name) ||
    (b.event_type && typeof b.event_type === "object" && b.event_type.name) ||
    "";
  const funnel = String(
    b.funnel_name ||
    b.funnel ||
    d.funnel_name ||
    d.funnel ||
    b.page_name ||
    d.page_name ||
    eventTypeName ||
    ""
  ).trim();

  // Stable ID for idempotency: prefer CF's own event/contact/submission id.
  const id =
    b.id ||
    b.event_id ||
    b.submission_id ||
    d.id ||
    d.submission_id ||
    (contact.id ? String(contact.id) : null) ||
    null;

  // Survey answers: CF Classic → contact.survey_answers or data.survey_answers.
  // CF 2.0 → data.formData, data.answers, data.fields, contact.custom_fields.
  // Skip for appointments — formData-style keys must not turn a booking into a survey.
  const answers = isAppointmentType(type)
    ? null
    : contact.survey_answers ||
      d.survey_answers ||
      d.formData ||
      d.form_data ||
      d.answers ||
      d.fields ||
      contact.custom_fields ||
      null;

  // Referral attribution params (a1=tier1 affiliate, a2=tier2 affiliate).
  // CF appends these as query params on the funnel URL; they appear either at top-
  // level, under data, or in contact.custom_fields. af-02 gates on these.
  const a1 = String(
    b.a1 || d.a1 || contact.a1 || contact.custom_fields?.a1 || ""
  ).trim() || null;
  const a2 = String(
    b.a2 || d.a2 || contact.a2 || contact.custom_fields?.a2 || ""
  ).trim() || null;

  // Appointment slot fields — same names the Cal.com adapter emits downstream.
  const startTime = d.start_on || d.startTime || b.start_on || null;
  const endTime = d.end_on || d.endTime || b.end_on || null;
  const tzid = d.tzid || b.tzid || null;
  const bookingUid = id ? String(id) : null;

  return {
    id: id ? String(id) : null,
    type,
    email,
    name,
    phone,
    funnel,
    answers,
    a1,
    a2,
    bookingUid,
    startTime,
    endTime,
    tzid,
    meetingUrl: null,
    rescheduleUid: null
  };
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Appointments → booking.* only (never entry.captured).
// Opt-in / form submissions → entry.captured (+ survey.submitted when answers).
// Returns [] when there is no email (nothing to emit).
export function mapToCanonical(evt) {
  if (!evt || !evt.email) return [];

  const type = String(evt.type || "").toLowerCase();
  if (type === APPOINTMENT_CREATED) return [{ name: "booking.created" }];
  if (type === APPOINTMENT_RESCHEDULED) return [{ name: "booking.rescheduled" }];
  if (type === APPOINTMENT_CANCELED) return [{ name: "booking.cancelled" }];

  const out = [];
  out.push({ name: "entry.captured" });
  if (evt.answers !== null && evt.answers !== undefined) {
    out.push({ name: "survey.submitted" });
  }
  return out;
}

// --- Adapter entrypoint -----------------------------------------------------
// handleClickFunnelsWebhook({ db, rawBody, signatureHeader, secret })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Verifies signature (fail-closed), parses JSON, maps to canonical events, and
// emits each via the bus. Idempotency key: `clickfunnels:<eventId>:<canonicalName>`.
export async function handleClickFunnelsWebhook({ db, rawBody, signatureHeader, secret }) {
  if (!verifyClickFunnelsSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }

  // CF_CAPTURE_MODE — raw payload capture for adapter correction (CF Classic vs
  // 2.0 field-path drift, see the header note above). Fires after signature
  // verify + JSON parse succeed, so only real deliveries are captured. A capture
  // failure must never block the normal processing path below — try/catch and
  // move on.
  if (process.env.CF_CAPTURE_MODE === "1") {
    try {
      await db.query(
        `INSERT INTO webhook_captures (provider, headers, raw_body, parsed)
         VALUES ($1,$2,$3,$4)`,
        ["clickfunnels", JSON.stringify({ "x-cf-signature": signatureHeader || null }), rawBody, JSON.stringify(body)]
      );
    } catch (err) {
      console.warn(`[clickfunnels] webhook capture failed (non-fatal): ${String(err?.message || err)}`);
    }
  }

  const evt = normalizeClickFunnelsEvent(body);

  if (!evt.email) {
    return { ok: true, status: 200, reason: "no_email", emitted: [] };
  }

  const canonical = mapToCanonical(evt);
  if (canonical.length === 0) {
    return { ok: true, status: 200, reason: "no_canonical_events", emitted: [] };
  }

  const emitted = [];
  for (const c of canonical) {
    let payload;
    if (c.name === "survey.submitted") {
      payload = {
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        funnel: evt.funnel,
        source: "clickfunnels",
        answers: evt.answers,
        a1: evt.a1,
        a2: evt.a2
      };
    } else if (
      c.name === "booking.created" ||
      c.name === "booking.rescheduled" ||
      c.name === "booking.cancelled"
    ) {
      // Same shape as src/adapters/calcom.mjs so booking handlers stay unchanged.
      payload = {
        bookingUid: evt.bookingUid,
        startTime: evt.startTime,
        endTime: evt.endTime,
        email: evt.email,
        name: evt.name,
        meetingUrl: evt.meetingUrl,
        rescheduleUid: evt.rescheduleUid,
        source: "clickfunnels"
      };
    } else {
      payload = {
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        funnel: evt.funnel,
        source: "clickfunnels",
        a1: evt.a1,
        a2: evt.a2
      };
    }

    const idKey = evt.id ? `clickfunnels:${evt.id}:${c.name}` : undefined;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted };
}
