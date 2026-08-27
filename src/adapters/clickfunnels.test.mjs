import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyClickFunnelsSignature,
  normalizeClickFunnelsEvent,
  mapToCanonical,
  handleClickFunnelsWebhook
} from "./clickfunnels.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — same fakeDb helper as commas.test.mjs.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_cf_test";
/** Legacy: HMAC(raw body) — still accepted when timestamp omitted. */
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
/** CF 2.0 official: HMAC(`${timestamp}.${raw}`). */
const signV2 = (raw, ts) =>
  crypto.createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");

// --- signature ---------------------------------------------------------------
test("verifyClickFunnelsSignature: accepts valid sig, rejects tampered / missing / no-secret", () => {
  const raw = JSON.stringify({ event: "form_submission" });
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyClickFunnelsSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed variant
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw + "x"), SECRET), false); // tampered
  assert.equal(verifyClickFunnelsSignature(raw, "", SECRET), false);              // missing header
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), null), false);         // no secret => closed
});

test("verifyClickFunnelsSignature: CF 2.0 timestamp.payload scheme", () => {
  const raw = JSON.stringify({ event_type: "contact.created" });
  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyClickFunnelsSignature(raw, signV2(raw, ts), SECRET, ts), true);
  assert.equal(verifyClickFunnelsSignature(raw, "sha256=" + signV2(raw, ts), SECRET, ts), true);
  // Wrong: body-only sig against V2 signed payload
  assert.equal(verifyClickFunnelsSignature(raw, sign(raw), SECRET, ts), false);
  // Stale timestamp (>600s)
  const stale = String(Math.floor(Date.now() / 1000) - 601);
  assert.equal(verifyClickFunnelsSignature(raw, signV2(raw, stale), SECRET, stale), false);
});

test("handleClickFunnelsWebhook: CF 2.0 headers (x-webhook-clickfunnels-*) accept", async () => {
  clearHandlers();
  _resetOrgCache();
  const raw = JSON.stringify({
    event_type: "contact.created",
    data: { contact: { email: "v2sig@example.com", first_name: "V2" } }
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    secret: SECRET,
    headers: {
      "x-webhook-clickfunnels-signature": signV2(raw, ts),
      "x-webhook-clickfunnels-timestamp": ts
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.ok(res.emitted.some((e) => e.name === "entry.captured"));
});

// --- normalize ---------------------------------------------------------------
test("normalizeClickFunnelsEvent: reads CF 2.0 shape (data.contact)", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_abc123",
    event: "contact_created",
    funnel_name: "Free Credit Audit",
    data: {
      contact: {
        email: "JANE@EXAMPLE.COM",
        first_name: "Jane",
        last_name: "Doe",
        phone: "555-123-4567"
      }
    }
  });
  assert.equal(evt.email, "jane@example.com");
  assert.equal(evt.name, "Jane Doe");
  assert.equal(evt.phone, "555-123-4567");
  assert.equal(evt.funnel, "Free Credit Audit");
  assert.equal(evt.id, "sub_abc123");
  assert.equal(evt.answers, null);
  assert.equal(evt.a1, null);
  assert.equal(evt.a2, null);
});

test("normalizeClickFunnelsEvent: extracts a1/a2 referral params from top-level", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "sub_ref1",
    a1: "affiliate-abc",
    a2: "sub-affiliate-xyz",
    data: { contact: { email: "ref@example.com", first_name: "Ref" } }
  });
  assert.equal(evt.a1, "affiliate-abc");
  assert.equal(evt.a2, "sub-affiliate-xyz");
});

test("normalizeClickFunnelsEvent: reads CF Classic top-level contact shape", () => {
  const evt = normalizeClickFunnelsEvent({
    type: "new_purchase",
    contact: {
      email: "bob@example.com",
      full_name: "Bob Smith",
      phone_number: "555-999-0000"
    },
    funnel: "Main Funnel"
  });
  assert.equal(evt.email, "bob@example.com");
  assert.equal(evt.name, "Bob Smith");
  assert.equal(evt.phone, "555-999-0000");
  assert.equal(evt.funnel, "Main Funnel");
});

test("normalizeClickFunnelsEvent: reads survey answers from data.survey_answers", () => {
  const answers = { q1: "Yes", q2: "750+" };
  const evt = normalizeClickFunnelsEvent({
    id: "sub_survey_1",
    data: {
      contact: { email: "alice@example.com", first_name: "Alice", last_name: "A" },
      survey_answers: answers
    }
  });
  assert.deepEqual(evt.answers, answers);
  assert.equal(evt.email, "alice@example.com");
});

test("normalizeClickFunnelsEvent: reads survey from data.formData (CF 2.0 variant)", () => {
  const formData = [{ field: "q1", value: "No" }];
  const evt = normalizeClickFunnelsEvent({
    data: {
      contact: { email: "carol@example.com" },
      formData
    }
  });
  assert.deepEqual(evt.answers, formData);
});

test("normalizeClickFunnelsEvent: CF 2.0 contact row is data (email_address + custom_attributes)", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.identified",
    event_id: "cf-evt-1",
    data: {
      id: 99,
      email_address: "Lead@Example.com",
      phone_number: "(602) 555-0151",
      first_name: "Chris",
      last_name: "Seam",
      custom_attributes: {
        cf_svy_planned_use: "Growth",
        sdk_ts: "ignore-me"
      }
    }
  });
  assert.equal(evt.email, "lead@example.com");
  assert.equal(evt.phone, "(602) 555-0151");
  assert.equal(evt.name, "Chris Seam");
  assert.deepEqual(evt.answers, { cf_svy_planned_use: "Growth" });
});

test("normalizeClickFunnelsEvent: keeps Facebook UTM from first_visit, drops the click id", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "contact.created",
    data: {
      email_address: "ad@example.com",
      first_name: "Ad",
      last_name: "Lead",
      visits: {
        first_visit: {
          landing_page: "https://apply.fundhub.ai/watch?utm_source=fb_ad&fbclid=DROPME",
          referring_domain: "m.facebook.com",
          utm_source: "fb_ad",
          utm_campaign: "oSched%3A+VSL%3A+Funding",
          utm_content: "oVid%3A+3"
        }
      }
    }
  });
  assert.deepEqual(evt.attribution, {
    utm_source: "fb_ad",
    utm_medium: null,
    utm_campaign: "oSched: VSL: Funding",
    utm_content: "oVid: 3",
    utm_term: null,
    landing_path: "/watch",
    referrer_domain: "m.facebook.com"
  });
});

test("normalizeClickFunnelsEvent: form_submission nested appointments_schedule_request", () => {
  const evt = normalizeClickFunnelsEvent({
    event_type: "form_submission.created",
    event_id: "fs-1",
    data: {
      id: 1,
      data: {
        contact: { email: "book@example.com" },
        appointments_schedule_request: {
          name: "Chris Seam",
          email: "Book@Example.com",
          phone_number: "(602) 555-0151",
          start_on: "2026-08-13T01:00:00Z",
          end_on: "2026-08-13T01:30:00Z",
          tzid: "America/Phoenix"
        }
      }
    }
  });
  assert.equal(evt.email, "book@example.com");
  assert.equal(evt.phone, "(602) 555-0151");
  assert.equal(evt.name, "Chris Seam");
  assert.equal(evt.startTime, "2026-08-13T01:00:00Z");
});

// --- mapToCanonical ----------------------------------------------------------
test("mapToCanonical: email-only lead => entry.captured only", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: null }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured"]);
});

test("mapToCanonical: lead + survey => entry.captured + survey.submitted", () => {
  const names = mapToCanonical({ email: "a@b.com", answers: { q1: "Yes" } }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
});

test("mapToCanonical: no email => empty array", () => {
  assert.deepEqual(mapToCanonical({ email: "", answers: null }), []);
  assert.deepEqual(mapToCanonical(null), []);
});

test("mapToCanonical: appointment created => booking.created only (no entry.captured)", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.created",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: appointment rescheduled => booking.rescheduled only", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.rescheduled"
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.rescheduled"]);
});

test("mapToCanonical: appointment canceled => booking.cancelled only", () => {
  const names = mapToCanonical({
    email: "a@b.com",
    type: "appointments/scheduled_event.canceled"
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.cancelled"]);
});

test("mapToCanonical: form_submission with startTime => booking.created only", () => {
  const names = mapToCanonical({
    email: "book@example.com",
    type: "form_submission.created",
    startTime: "2026-08-13T01:00:00Z",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: form_submission without startTime stays entry.captured", () => {
  const names = mapToCanonical({
    email: "lead@example.com",
    type: "form_submission.created",
    answers: null
  }).map((c) => c.name);
  assert.deepEqual(names, ["entry.captured"]);
});

test("normalizeClickFunnelsEvent: appointment reads data.primary_contact + slot fields", () => {
  const evt = normalizeClickFunnelsEvent({
    id: "appt_99",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-10T15:00:00Z",
      end_on: "2026-08-10T15:30:00Z",
      tzid: "America/Los_Angeles",
      event_type: { name: "Strategy Session" },
      primary_contact: {
        email_address: "BOOK@EXAMPLE.COM",
        first_name: "Book",
        last_name: "Me",
        phone_number: "555-222-3333"
      }
    }
  });
  assert.equal(evt.email, "book@example.com");
  assert.equal(evt.name, "Book Me");
  assert.equal(evt.phone, "555-222-3333");
  assert.equal(evt.type, "appointments/scheduled_event.created");
  assert.equal(evt.startTime, "2026-08-10T15:00:00Z");
  assert.equal(evt.endTime, "2026-08-10T15:30:00Z");
  assert.equal(evt.tzid, "America/Los_Angeles");
  assert.equal(evt.funnel, "Strategy Session");
  assert.equal(evt.bookingUid, "appt_99");
  assert.equal(evt.answers, null);
});

// --- full adapter ------------------------------------------------------------
test("handleClickFunnelsWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ event: "form_submission", data: { contact: { email: "x@y.com" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleClickFunnelsWebhook: lead without survey => entry.captured only, handler fires", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_lead_1",
    event: "contact_created",
    funnel_name: "Free Audit Funnel",
    data: { contact: { email: "lead@example.com", first_name: "Lead", last_name: "User", phone: "555-000-1111" } }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
  assert.deepEqual(seen, ["entry.captured"]);
});

test("handleClickFunnelsWebhook: lead + survey => entry.captured + survey.submitted, both handlers fire", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  on("survey.submitted", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_survey_42",
    event: "form_submission",
    data: {
      contact: { email: "quiz@example.com", first_name: "Quiz", last_name: "Taker", phone: "555-777-8888" },
      survey_answers: { q1: "Yes", q2: "Good" }
    }
  });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured", "survey.submitted"]);
  assert.deepEqual(seen.sort(), ["entry.captured", "survey.submitted"]);
  // survey payload includes answers
  assert.equal(res.emitted.find((e) => e.name === "survey.submitted") !== undefined, true);
});

test("handleClickFunnelsWebhook: a1/a2 referral params flow into entry.captured payload", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_ref_42",
    a1: "tier1-aff",
    a2: "tier2-aff",
    event: "contact_created",
    data: { contact: { email: "reftest@example.com", first_name: "Ref" } }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  const entryPayload = store.find((r) => r.name === "entry.captured")?.payload;
  assert.equal(entryPayload?.a1, "tier1-aff");
  assert.equal(entryPayload?.a2, "tier2-aff");
});

test("handleClickFunnelsWebhook: appointment created => booking.created, no entry.captured", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_appt_1",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-12T18:00:00Z",
      end_on: "2026-08-12T18:30:00Z",
      tzid: "America/New_York",
      event_type: { name: "Closer Call" },
      primary_contact: {
        email_address: "appt@example.com",
        first_name: "Appt",
        last_name: "Lead",
        phone_number: "555-444-5555"
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.created"]);
  assert.deepEqual(seen, ["booking.created"]);
  const payload = store.find((r) => r.name === "booking.created")?.payload;
  assert.deepEqual(payload, {
    bookingUid: "cf_appt_1",
    startTime: "2026-08-12T18:00:00Z",
    endTime: "2026-08-12T18:30:00Z",
    email: "appt@example.com",
    name: "Appt Lead",
    phone: "555-444-5555",
    meetingUrl: null,
    rescheduleUid: null,
    source: "clickfunnels"
  });
});

test("handleClickFunnelsWebhook: form_submission with nested schedule => booking.created with email", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: "evt-1" }] };
      }
      if (/FROM bookings/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    event_type: "form_submission.created",
    event_id: "fs-book-1",
    data: {
      id: 1,
      data: {
        contact: { email: "book@example.com" },
        appointments_schedule_request: {
          name: "Chris Seam",
          email: "Book@Example.com",
          phone_number: "(602) 555-0151",
          start_on: "2026-08-13T01:00:00Z",
          end_on: "2026-08-13T01:30:00Z",
          tzid: "America/Phoenix"
        }
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.created"]);
  assert.deepEqual(seen, ["booking.created"]);
  const payload = store.find((r) => r.name === "booking.created")?.payload;
  assert.equal(payload.email, "book@example.com");
  assert.equal(payload.startTime, "2026-08-13T01:00:00Z");
  assert.equal(payload.source, "clickfunnels");
});

test("handleClickFunnelsWebhook: appointment after same slot does not emit a second booking.created", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.created", (e) => seen.push(e.name));
  let eventInserts = 0;
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/FROM bookings/.test(sql)) {
        return { rows: [{ id: "bk-1", client_id: "client-1", provider_uid: "fs-book-1" }] };
      }
      if (/UPDATE bookings/.test(sql)) return { rows: [] };
      if (/UPDATE tasks/.test(sql)) return { rows: [] };
      if (/INSERT INTO events/.test(sql)) {
        eventInserts += 1;
        return { rows: [{ id: "evt-should-not" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_appt_later",
    event: "appointments/scheduled_event.created",
    data: {
      start_on: "2026-08-13T01:00:00Z",
      end_on: "2026-08-13T01:30:00Z",
      primary_contact: {
        email_address: "book@example.com",
        first_name: "Chris",
        last_name: "Seam"
      }
    }
  });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted[0].deduped, true);
  assert.equal(eventInserts, 0);
  assert.deepEqual(seen, []);
});

test("handleClickFunnelsWebhook: appointment canceled => booking.cancelled only", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.cancelled", (e) => seen.push(e.name));
  on("entry.captured", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    id: "cf_appt_cancel",
    event: "appointments/scheduled_event.canceled",
    data: {
      start_on: "2026-08-12T18:00:00Z",
      end_on: "2026-08-12T18:30:00Z",
      primary_contact: { email_address: "cancel@example.com", first_name: "C" }
    }
  });
  const res = await handleClickFunnelsWebhook({
    db: fakeDb(),
    rawBody: raw,
    signatureHeader: sign(raw),
    secret: SECRET
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.emitted.map((e) => e.name), ["booking.cancelled"]);
  assert.deepEqual(seen, ["booking.cancelled"]);
});

test("handleClickFunnelsWebhook: no_email => 200, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ id: "cf_noemail", event: "form_submission", data: { contact: { first_name: "Ghost" } } });
  const res = await handleClickFunnelsWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "no_email");
  assert.equal(res.emitted.length, 0);
});

// --- CF_CAPTURE_MODE ----------------------------------------------------------
test("handleClickFunnelsWebhook: CF_CAPTURE_MODE=1 inserts a webhook_captures row and still emits normally", async () => {
  _resetOrgCache(); clearHandlers();
  const captures = [];
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) {
        captures.push({ provider: params[0], headers: params[1], rawBody: params[2], parsed: params[3] });
        return { rows: [] };
      }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_capture_1",
    event: "contact_created",
    data: { contact: { email: "captured@example.com", first_name: "Cap" } }
  });
  const prev = process.env.CF_CAPTURE_MODE;
  process.env.CF_CAPTURE_MODE = "1";
  try {
    const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.ok, true);
    assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
    assert.deepEqual(seen, ["entry.captured"]);
    assert.equal(captures.length, 1);
    assert.equal(captures[0].provider, "clickfunnels");
    assert.equal(captures[0].rawBody, raw);
    assert.equal(JSON.parse(captures[0].parsed).id, "cf_capture_1");
  } finally {
    if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
    else process.env.CF_CAPTURE_MODE = prev;
  }
});

test("handleClickFunnelsWebhook: capture failure is non-fatal — processing still completes", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("entry.captured", (e) => seen.push(e.name));
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) throw new Error("capture table unavailable");
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_capture_fail",
    event: "contact_created",
    data: { contact: { email: "stillworks@example.com" } }
  });
  const prev = process.env.CF_CAPTURE_MODE;
  process.env.CF_CAPTURE_MODE = "1";
  try {
    const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
    assert.equal(res.ok, true);
    assert.deepEqual(res.emitted.map((e) => e.name), ["entry.captured"]);
    assert.deepEqual(seen, ["entry.captured"]);
  } finally {
    if (prev === undefined) delete process.env.CF_CAPTURE_MODE;
    else process.env.CF_CAPTURE_MODE = prev;
  }
});

test("handleClickFunnelsWebhook: CF_CAPTURE_MODE unset — no capture insert", async () => {
  _resetOrgCache(); clearHandlers();
  let captureCalls = 0;
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO webhook_captures/.test(sql)) { captureCalls += 1; return { rows: [] }; }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    id: "cf_no_capture",
    event: "contact_created",
    data: { contact: { email: "nocapture@example.com" } }
  });
  delete process.env.CF_CAPTURE_MODE;
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(captureCalls, 0, "no capture insert when CF_CAPTURE_MODE is unset");
});

test("handleClickFunnelsWebhook: idempotent re-delivery (deduped, no handler dispatch)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("entry.captured", () => (fired += 1));
  const raw = JSON.stringify({
    id: "cf_idem_1",
    event: "contact_created",
    data: { contact: { email: "idem@example.com" } }
  });
  const db = fakeDb({ dedup: true });
  const res = await handleClickFunnelsWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events must be deduped");
  assert.equal(fired, 0, "handler must not fire on deduped replay");
});

test("handleClickFunnelsWebhook: signed paid order writes a sale from the SLO map, not email", async () => {
  _resetOrgCache();
  clearHandlers();
  const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const store = { sales: [] };
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/FROM slo_connections/.test(sql)) {
        return { rows: [{ id: "conn-1", product_id: PRODUCT, product_name: "Funding Bundle", active: true }] };
      }
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      if (/FROM sales/.test(sql)) return { rows: store.sales };
      if (/INSERT INTO transactions/.test(sql)) return { rows: [{ id: "tx-1" }] };
      if (/INSERT INTO sales/.test(sql)) {
        const row = { id: "sale-1", client_id: params[1], product_id: params[2], agreed_price: params[3], external_ref: params[4] };
        store.sales.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO sale_payments/.test(sql)) return { rows: [{ id: "pay-1" }] };
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: "evt-1" }] };
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({
    event_id: "slo-sim-paid-1",
    event_type: "order.completed",
    funnel_id: "funnel-slo-1",
    data: {
      id: 9001,
      amount_cents: 19700,
      contact: {
        email: "wrong-person@example.com",
        custom_attributes: { fundhub_client_id: CLIENT }
      },
      line_items: [{ product_id: "cf-prod-slo-1" }]
    }
  });
  const res = await handleClickFunnelsWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.purchase.reason, "recorded");
  assert.equal(store.sales.length, 1);
  assert.equal(store.sales[0].client_id, CLIENT);
  assert.equal(store.sales[0].product_id, PRODUCT);
  assert.equal(Number(store.sales[0].agreed_price), 197);
});
