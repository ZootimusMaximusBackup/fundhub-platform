// ClickFunnels webhook adapter — lead capture + survey submission events.
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

// --- 2. Normalize the webhook body into a flat event ------------------------
// Reads defensively from CF Classic + 2.0 shapes. Returns null when no usable
// data is found (caller treats as no-op).
export function normalizeClickFunnelsEvent(body) {
  const b = body || {};

  // CF 2.0 wraps everything under `data`; Classic may have a top-level contact.
  const d = (b.data && typeof b.data === "object" ? b.data : null) || b;

  // Contact block: CF Classic = contact at top or data.contact; 2.0 = data.contact.
  const contact =
    (d.contact && typeof d.contact === "object" ? d.contact : null) ||
    (b.contact && typeof b.contact === "object" ? b.contact : null) ||
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

  // Funnel name / page name for tracing.
  const funnel = String(
    b.funnel_name ||
    b.funnel ||
    d.funnel_name ||
    d.funnel ||
    b.page_name ||
    d.page_name ||
    ""
  ).trim();

  // Event type / hook type.
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
  const answers =
    contact.survey_answers ||
    d.survey_answers ||
    d.formData ||
    d.form_data ||
    d.answers ||
    d.fields ||
    contact.custom_fields ||
    null;

  return {
    id: id ? String(id) : null,
    type,
    email,
    name,
    phone,
    funnel,
    answers
  };
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Every opt-in / form submission emits `entry.captured`.
// If the payload also carries survey answers, emit `survey.submitted` too.
// Returns [] when there is no email (nothing to emit).
export function mapToCanonical(evt) {
  if (!evt || !evt.email) return [];

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
    const payload =
      c.name === "survey.submitted"
        ? { email: evt.email, name: evt.name, phone: evt.phone, funnel: evt.funnel, source: "clickfunnels", answers: evt.answers }
        : { email: evt.email, name: evt.name, phone: evt.phone, funnel: evt.funnel, source: "clickfunnels" };

    const idKey = evt.id ? `clickfunnels:${evt.id}:${c.name}` : undefined;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted };
}
