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
import { emit, defaultOrgId } from "../events/bus.mjs";
import { handleSloPaidWebhook } from "../slo/purchase.mjs";

// --- 1. Signature verification (fail-closed) --------------------------------
// ClickFunnels 2.0 (official): HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
// Headers: X-Webhook-ClickFunnels-Signature + X-Webhook-ClickFunnels-Timestamp
// (see https://developers.myclickfunnels.com/docs/signature-verification).
// Timestamp must be within 600s. Optional "sha256=" prefix on the signature.
// Legacy fallback (no timestamp): HMAC of raw body only — kept for internal
// probes / older tests. Live CF V2 always sends the timestamp header.
export function verifyClickFunnelsSignature(rawBody, header, secret, timestamp) {
  if (!secret) return false;
  const provided = String(header || "").trim();
  if (!provided) return false;
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;

  const ts = String(timestamp ?? "").trim();
  let expected;
  if (ts) {
    const tsInt = Number(ts);
    if (!Number.isFinite(tsInt)) return false;
    const skew = Math.abs(Math.floor(Date.now() / 1000) - tsInt);
    if (skew > 600) return false;
    expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody || ""}`).digest("hex");
  } else {
    expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const want = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

// Appointment webhook types (ClickFunnels booking calendar).
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

/* ClickFunnels sends every single/multi-select answer TWICE: the answer-option
   row id on `cf_svy_<key>`, and the words the person actually picked on
   `cf_svy_<key>_label` (single) or `cf_svy_<key>_labels` (multi, a JSON array,
   sometimes already encoded as a string). Copying the id through verbatim is
   what put "207883" on a client-facing slide and on the sales deck (F11) and
   left internal screens reading a bare number (F8) — every screen then had to
   grow its own id-suppressing guard, and each one that forgot leaked the id.
   Resolve it once, here, where the payload still has both halves. */
function isCfOptionId(v) {
  if (typeof v === "number") return v >= 10000;
  return typeof v === "string" && /^\d{5,}$/.test(v.trim());
}

/** The words CF sent for `key`, from its _label / _labels sibling. */
function cfLabelsFor(obj, key) {
  const single = obj[`${key}_label`];
  if (single != null && single !== "") return String(single);
  const many = obj[`${key}_labels`];
  if (many == null || many === "") return null;
  if (Array.isArray(many)) {
    const words = many.filter((x) => x != null && x !== "").map(String);
    return words.length ? words : null;
  }
  try {
    const parsed = JSON.parse(String(many));
    if (Array.isArray(parsed)) {
      const words = parsed.filter((x) => x != null && x !== "").map(String);
      return words.length ? words : null;
    }
  } catch {
    /* not JSON — CF sent a plain string */
  }
  return String(many);
}

/** Pull only FundHub survey keys from a CF attributes/fields object. */
function pickSurveyAnswers(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!String(k).startsWith("cf_svy_")) continue;
    if (v == null || v === "") continue;
    out[k] = v;
  }
  for (const k of Object.keys(out)) {
    if (k.endsWith("_label") || k.endsWith("_labels")) continue;
    const v = out[k];
    const isIdList = Array.isArray(v) && v.length > 0 && v.every(isCfOptionId);
    if (!isIdList && !isCfOptionId(v)) continue;
    const words = cfLabelsFor(out, k);
    /* No label came with the id. Keep the id rather than dropping the answer —
       "they answered, we cannot read it" is a finding; silence is not. */
    if (words == null) continue;
    out[k] = Array.isArray(v)
      ? (Array.isArray(words) ? words : [words])
      : (Array.isArray(words) ? words.join(", ") : words);
  }
  return Object.keys(out).length ? out : null;
}

function decodeUtm(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

function landingPathOf(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return u.pathname || null;
  } catch {
    const s = String(url);
    const cut = s.split("?")[0];
    const i = cut.indexOf("/", cut.indexOf("//") + 2);
    return i >= 0 ? cut.slice(i) : null;
  }
}

/* Facebook / UTM attribution. Never keep click ids (fbclid).

   THREE PLACES, IN ORDER OF TRUST, FIELD BY FIELD:
     1. an explicit `attribution` object on the payload (what the application
        form's hidden fields post — clickfunnels-fragments/06-utm-hidden-fields.html)
     2. the same keys as hidden fields on the contact (custom_attributes /
        custom_fields), which is where ClickFunnels puts a form's hidden inputs
     3. CF's own visits.first_visit, the pre-existing source
   The hidden fields win because they carry the UTMs of the ad URL the person
   actually arrived on; first_visit can be an older visit from a different ad. */
function firstObject(...cands) {
  for (const c of cands) if (c && typeof c === "object" && !Array.isArray(c)) return c;
  return null;
}
function pickVisitAttribution(d, b, contact) {
  const visit =
    (d && d.visits && d.visits.first_visit) ||
    (b && b.visits && b.visits.first_visit) ||
    (contact && contact.visits && contact.visits.first_visit) ||
    {};
  const explicit = firstObject(b && b.attribution, d && d.attribution, contact && contact.attribution) || {};
  const hidden = firstObject(
    contact && contact.custom_attributes, d && d.custom_attributes,
    contact && contact.custom_fields, d && d.custom_fields
  ) || {};
  const pick = (k) => decodeUtm(explicit[k]) ?? decodeUtm(hidden[k]) ?? decodeUtm(visit[k]);
  const landing =
    explicit.landing_path || landingPathOf(explicit.landing_page) ||
    hidden.landing_path || landingPathOf(hidden.landing_page) ||
    landingPathOf(visit.landing_page || visit.url);
  const out = {
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_content: pick("utm_content"),
    utm_term: pick("utm_term"),
    landing_path: landing || null,
    referrer_domain: explicit.referrer_domain || hidden.referrer_domain || visit.referring_domain || null
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Reads defensively from CF Classic + 2.0 shapes. Returns null when no usable
// data is found (caller treats as no-op).
export function normalizeClickFunnelsEvent(body) {
  const b = body || {};

  // CF 2.0 wraps everything under `data`; Classic may have a top-level contact.
  const d = (b.data && typeof b.data === "object" ? b.data : null) || b;
  // form_submission.created nests contact + booking under data.data.
  const nested =
    d.data && typeof d.data === "object" && !Array.isArray(d.data) ? d.data : null;
  const schedule =
    (nested && nested.appointments_schedule_request && typeof nested.appointments_schedule_request === "object"
      ? nested.appointments_schedule_request
      : null) ||
    (d.appointments_schedule_request && typeof d.appointments_schedule_request === "object"
      ? d.appointments_schedule_request
      : null);

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

  // Contact block: appointments → data.primary_contact; form_submission →
  // data.data.contact; otherwise CF Classic / 2.0 contact shapes (contact.* or
  // the contact row itself as `data` with email_address).
  const primary =
    d.primary_contact && typeof d.primary_contact === "object" ? d.primary_contact : null;
  const nestedContact =
    nested && nested.contact && typeof nested.contact === "object" ? nested.contact : null;
  const contact =
    (isAppointmentType(type) && primary) ||
    (d.contact && typeof d.contact === "object" ? d.contact : null) ||
    nestedContact ||
    (b.contact && typeof b.contact === "object" ? b.contact : null) ||
    primary ||
    schedule ||
    d ||
    b;

  // Email — most critical field.
  const email = String(
    contact.email ||
    contact.email_address ||
    schedule?.email ||
    nestedContact?.email ||
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
    contact.name ||
    schedule?.name ||
    d.full_name ||
    b.full_name ||
    (firstName || lastName ? `${firstName} ${lastName}`.trim() : "")
  ).trim();

  // Phone: several CF field names in use.
  const phone = String(
    contact.phone ||
    contact.phone_number ||
    contact.phoneNumber ||
    schedule?.phone_number ||
    schedule?.phone ||
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
  const funnelObj = b.funnel || d.funnel || (d.page && d.page.funnel) || null;
  const funnel = String(
    b.funnel_name ||
    (typeof b.funnel === "string" ? b.funnel : "") ||
    (funnelObj && typeof funnelObj === "object" ? funnelObj.name : "") ||
    d.funnel_name ||
    (typeof d.funnel === "string" ? d.funnel : "") ||
    b.page_name ||
    d.page_name ||
    (d.page && d.page.name) ||
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
  // CF 2.0 → data.formData / answers / fields, or Contact Attributes on
  // custom_attributes / custom_fields (only cf_svy_* keys count).
  // Skip for appointments — formData-style keys must not turn a booking into a survey.
  const rawAnswers = isAppointmentType(type)
    ? null
    : contact.survey_answers ||
      d.survey_answers ||
      d.formData ||
      d.form_data ||
      d.answers ||
      d.fields ||
      null;
  const fromAttrs =
    pickSurveyAnswers(contact.custom_attributes) ||
    pickSurveyAnswers(d.custom_attributes) ||
    pickSurveyAnswers(contact.custom_fields) ||
    pickSurveyAnswers(d.custom_fields);
  const answers = pickSurveyAnswers(rawAnswers) || fromAttrs || (rawAnswers && typeof rawAnswers === "object" ? rawAnswers : null);

  // Referral attribution params (a1=tier1 affiliate, a2=tier2 affiliate).
  // CF appends these as query params on the funnel URL; they appear either at top-
  // level, under data, or in contact.custom_fields. af-02 gates on these.
  const a1 = String(
    b.a1 || d.a1 || contact.a1 || contact.custom_fields?.a1 || contact.custom_attributes?.a1 || ""
  ).trim() || null;
  const a2 = String(
    b.a2 || d.a2 || contact.a2 || contact.custom_fields?.a2 || contact.custom_attributes?.a2 || ""
  ).trim() || null;

  const attribution = pickVisitAttribution(d, b, contact);

  // Appointment slot fields the booking handlers already read.
  const startTime = d.start_on || d.startTime || schedule?.start_on || b.start_on || null;
  const endTime = d.end_on || d.endTime || schedule?.end_on || b.end_on || null;
  const tzid = d.tzid || schedule?.tzid || b.tzid || null;
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
    attribution,
    bookingUid,
    startTime,
    endTime,
    tzid,
    meetingUrl: null,
    rescheduleUid: null
  };
}

function isFormSubmissionType(type) {
  return String(type || "").includes("form_submission");
}

/** Same calendar slot from the form post and the later appointment webhook. */
async function findBookingBySlot(db, orgId, email, startTime) {
  if (!orgId || !email || !startTime) return null;
  const { rows } = await db.query(
    `SELECT id, client_id, provider_uid
       FROM bookings
      WHERE org_id = $1
        AND lower(attendee_email) = $2
        AND starts_at IS NOT DISTINCT FROM $3::timestamptz
      LIMIT 1`,
    [orgId, String(email).toLowerCase(), startTime]
  );
  return rows[0] || null;
}

async function promoteBookingUid(db, { orgId, existing, nextUid, meetingUrl }) {
  if (!existing || !nextUid || existing.provider_uid === nextUid) return;
  await db.query(
    `UPDATE bookings
        SET provider_uid = $1,
            meeting_url = COALESCE($2, meeting_url)
      WHERE org_id = $3 AND id = $4`,
    [nextUid, meetingUrl || null, orgId, existing.id]
  );
  if (existing.client_id && existing.provider_uid) {
    await db.query(
      `UPDATE tasks SET body = $1 WHERE client_id = $2 AND body = $3`,
      [nextUid, existing.client_id, existing.provider_uid]
    );
  }
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Appointments → booking.* only (never entry.captured).
// Calendar form posts (form_submission with a start time) → booking.created.
//   The thank-you page can paint before appointments/scheduled_event.created.
// Other opt-in / form submissions → entry.captured (+ survey.submitted when answers).
// Returns [] when there is no email (nothing to emit).
export function mapToCanonical(evt) {
  if (!evt || !evt.email) return [];

  const type = String(evt.type || "").toLowerCase();
  if (type === APPOINTMENT_CREATED) return [{ name: "booking.created" }];
  if (type === APPOINTMENT_RESCHEDULED) return [{ name: "booking.rescheduled" }];
  if (type === APPOINTMENT_CANCELED) return [{ name: "booking.cancelled" }];
  if (isFormSubmissionType(type) && evt.startTime) return [{ name: "booking.created" }];

  const out = [];
  out.push({ name: "entry.captured" });
  if (evt.answers !== null && evt.answers !== undefined) {
    out.push({ name: "survey.submitted" });
  }
  return out;
}

// --- Adapter entrypoint -----------------------------------------------------
// handleClickFunnelsWebhook({ db, rawBody, signatureHeader, secret, headers })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Verifies signature (fail-closed), parses JSON, maps to canonical events, and
// emits each via the bus. Idempotency key: `clickfunnels:<eventId>:<canonicalName>`.
export async function handleClickFunnelsWebhook({
  db,
  rawBody,
  signatureHeader,
  secret,
  headers
}) {
  const sig =
    signatureHeader ||
    headerValue(headers, "x-webhook-clickfunnels-signature") ||
    headerValue(headers, "x-clickfunnels-signature");
  const timestamp =
    headerValue(headers, "x-webhook-clickfunnels-timestamp") ||
    headerValue(headers, "x-clickfunnels-timestamp");
  if (!verifyClickFunnelsSignature(rawBody, sig, secret, timestamp)) {
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

  // SLO paid path: resolve from owner map + fundhub_client_id. Never email/price.
  const purchase = await handleSloPaidWebhook(db, body);

  const evt = normalizeClickFunnelsEvent(body);

  if (!evt.email) {
    const reason = purchase.reason && purchase.reason !== "not_paid_event"
      ? purchase.reason
      : "no_email";
    return { ok: true, status: 200, reason, emitted: [], purchase };
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
        a2: evt.a2,
        attribution: evt.attribution || null
      };
    } else if (
      c.name === "booking.created" ||
      c.name === "booking.rescheduled" ||
      c.name === "booking.cancelled"
    ) {
      // Same booking payload shape the handlers already read.
      payload = {
        bookingUid: evt.bookingUid,
        startTime: evt.startTime,
        endTime: evt.endTime,
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
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
        a2: evt.a2,
        attribution: evt.attribution || null
      };
    }

    const idKey = evt.id ? `clickfunnels:${evt.id}:${c.name}` : undefined;

    if (c.name === "booking.created") {
      const orgId = await defaultOrgId(db);
      const existing = await findBookingBySlot(db, orgId, evt.email, evt.startTime);
      if (existing) {
        await promoteBookingUid(db, {
          orgId,
          existing,
          nextUid: payload.bookingUid,
          meetingUrl: payload.meetingUrl
        });
        emitted.push({ name: c.name, id: existing.id, deduped: true });
        continue;
      }
    }

    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted, purchase };
}
