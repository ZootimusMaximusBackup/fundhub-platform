import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyCalcomSignature,
  normalizeCalcomEvent,
  mapToCanonical,
  handleCalcomWebhook
} from "./calcom.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";
import { handleWebhook } from "../http/router.mjs";
import { _resetRegistered } from "../register-all.mjs";

// Fake db — same shape as commas.test.mjs.
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

const SECRET = "calcom_test_secret";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

// Helper: build a minimal Cal.com webhook body.
function bookingBody(triggerEvent, overrides = {}) {
  return JSON.stringify({
    triggerEvent,
    payload: {
      uid: "booking-uid-abc",
      startTime: "2026-08-01T10:00:00Z",
      endTime: "2026-08-01T10:30:00Z",
      attendees: [{ email: "client@example.com", name: "Alice Smith" }],
      organizer: { email: "chris@fundhub.ai", name: "Chris" },
      eventType: { title: "Discovery Call" },
      ...overrides
    }
  });
}

// --- signature ---------------------------------------------------------------
test("verifyCalcomSignature: accepts valid hex HMAC", () => {
  const raw = JSON.stringify({ test: 1 });
  assert.equal(verifyCalcomSignature(raw, sign(raw), SECRET), true);
});

test("verifyCalcomSignature: rejects tampered body", () => {
  const raw = JSON.stringify({ test: 1 });
  assert.equal(verifyCalcomSignature(raw + "x", sign(raw), SECRET), false);
});

test("verifyCalcomSignature: rejects missing header", () => {
  const raw = JSON.stringify({ test: 1 });
  assert.equal(verifyCalcomSignature(raw, "", SECRET), false);
  assert.equal(verifyCalcomSignature(raw, null, SECRET), false);
});

test("verifyCalcomSignature: rejects when secret is null (fail-closed)", () => {
  const raw = JSON.stringify({ test: 1 });
  assert.equal(verifyCalcomSignature(raw, sign(raw), null), false);
});

// --- normalize ---------------------------------------------------------------
test("normalizeCalcomEvent: reads Cal.com webhook shape correctly", () => {
  const body = {
    triggerEvent: "BOOKING_CREATED",
    payload: {
      uid: "uid-123",
      startTime: "2026-08-01T10:00:00Z",
      endTime: "2026-08-01T10:30:00Z",
      attendees: [{ email: "ALICE@EXAMPLE.COM", name: "Alice" }]
    }
  };
  const evt = normalizeCalcomEvent(body);
  assert.equal(evt.triggerEvent, "BOOKING_CREATED");
  assert.equal(evt.bookingUid, "uid-123");
  assert.equal(evt.startTime, "2026-08-01T10:00:00Z");
  assert.equal(evt.email, "alice@example.com"); // lowercased
  assert.equal(evt.name, "Alice");
});

test("normalizeCalcomEvent: missing attendees yields empty email/name", () => {
  const evt = normalizeCalcomEvent({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "x" } });
  assert.equal(evt.email, "");
  assert.equal(evt.name, "");
});

test("normalizeCalcomEvent: extracts meetingUrl from metadata.videoCallUrl", () => {
  const evt = normalizeCalcomEvent({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "uid-1", metadata: { videoCallUrl: "https://meet.example.com/room-1" } }
  });
  assert.equal(evt.meetingUrl, "https://meet.example.com/room-1");
});

test("normalizeCalcomEvent: falls back to metadata.meetingUrl", () => {
  const evt = normalizeCalcomEvent({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "uid-1", metadata: { meetingUrl: "https://meet.example.com/room-2" } }
  });
  assert.equal(evt.meetingUrl, "https://meet.example.com/room-2");
});

test("normalizeCalcomEvent: falls back to payload.location when it looks like a URL", () => {
  const evt = normalizeCalcomEvent({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "uid-1", location: "https://zoom.us/j/12345" }
  });
  assert.equal(evt.meetingUrl, "https://zoom.us/j/12345");
});

test("normalizeCalcomEvent: payload.location that is not a URL yields no meetingUrl", () => {
  const evt = normalizeCalcomEvent({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "uid-1", location: "Phone call" }
  });
  assert.equal(evt.meetingUrl, null);
});

test("normalizeCalcomEvent: extracts rescheduleUid when present", () => {
  const evt = normalizeCalcomEvent({
    triggerEvent: "BOOKING_RESCHEDULED",
    payload: { uid: "uid-new", rescheduleUid: "uid-old" }
  });
  assert.equal(evt.rescheduleUid, "uid-old");
});

test("normalizeCalcomEvent: no rescheduleUid yields null", () => {
  const evt = normalizeCalcomEvent({ triggerEvent: "BOOKING_CREATED", payload: { uid: "uid-1" } });
  assert.equal(evt.rescheduleUid, null);
});

// --- canonical mapping -------------------------------------------------------
test("mapToCanonical: BOOKING_CREATED → booking.created", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_CREATED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: BOOKING_RESCHEDULED → booking.rescheduled (not booking.created)", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_RESCHEDULED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.rescheduled"]);
});

test("mapToCanonical: BOOKING_CANCELLED → booking.cancelled", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_CANCELLED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.cancelled"]);
});

test("mapToCanonical: BOOKING_NO_SHOW → booking.noshow", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_NO_SHOW" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.noshow"]);
});

test("mapToCanonical: MEETING_NO_SHOW → booking.noshow", () => {
  const names = mapToCanonical({ triggerEvent: "MEETING_NO_SHOW" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.noshow"]);
});

test("mapToCanonical: BOOKING_NO_SHOW_CREATED → booking.noshow", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_NO_SHOW_CREATED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.noshow"]);
});

test("mapToCanonical: unknown trigger → [] (ignored)", () => {
  assert.deepEqual(mapToCanonical({ triggerEvent: "MEETING_ENDED" }), []);
});

// --- full adapter ------------------------------------------------------------
test("handleCalcomWebhook: bad signature → 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = bookingBody("BOOKING_CREATED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleCalcomWebhook: BOOKING_CREATED → emits booking.created with correct payload", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.created", (e) => seen.push(e));
  const raw = bookingBody("BOOKING_CREATED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.emitted.length, 1);
  assert.equal(res.emitted[0].name, "booking.created");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].payload.bookingUid, "booking-uid-abc");
  assert.equal(seen[0].payload.email, "client@example.com");
  assert.equal(seen[0].payload.source, "calcom");
  assert.equal(seen[0].payload.endTime, "2026-08-01T10:30:00Z", "booking.created must include endTime from Cal.com payload.endTime");
});

test("handleCalcomWebhook: BOOKING_CANCELLED → emits booking.cancelled", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.cancelled", (e) => seen.push(e.payload.bookingUid));
  const raw = bookingBody("BOOKING_CANCELLED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.emitted.length, 1);
  assert.equal(res.emitted[0].name, "booking.cancelled");
  assert.deepEqual(seen, ["booking-uid-abc"]);
});

test("handleCalcomWebhook: unrecognized trigger → 200, ignored, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = bookingBody("MEETING_ENDED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.emitted.length, 0);
  assert.match(res.reason, /^ignored:/);
});

test("handleCalcomWebhook: no attendee email → 200, no_email, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "uid-no-email", startTime: "2026-08-01T10:00:00Z", attendees: [] }
  });
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "no_email");
  assert.equal(res.emitted.length, 0);
});

test("handleCalcomWebhook: idempotent re-delivery (deduped, handler not re-fired)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("booking.created", () => (fired += 1));
  const raw = bookingBody("BOOKING_CREATED");
  const db = fakeDb({ dedup: true });
  const res = await handleCalcomWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on deduped re-delivery");
});

test("handleCalcomWebhook: BOOKING_RESCHEDULED dispatches booking.rescheduled handler", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.rescheduled", (e) => seen.push(e.payload.bookingUid));
  const raw = bookingBody("BOOKING_RESCHEDULED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted[0].name, "booking.rescheduled");
  assert.deepEqual(seen, ["booking-uid-abc"]);
});

test("handleCalcomWebhook: BOOKING_NO_SHOW → emits booking.noshow", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.noshow", (e) => seen.push(e.payload.bookingUid));
  const raw = bookingBody("BOOKING_NO_SHOW");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted[0].name, "booking.noshow");
  assert.deepEqual(seen, ["booking-uid-abc"]);
});

test("handleCalcomWebhook: booking.created payload includes meetingUrl", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.created", (e) => seen.push(e.payload.meetingUrl));
  const raw = bookingBody("BOOKING_CREATED", { metadata: { videoCallUrl: "https://meet.example.com/abc" } });
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual(seen, ["https://meet.example.com/abc"]);
});

/* --- routing: /api/webhooks/cal must reach THIS adapter ----------------------
   netlify/functions/api.mjs slices the URL segment verbatim into the provider
   id, so a Cal.com webhook pointed at /api/webhooks/cal arrived as "cal",
   missed the router's provider table and answered 404 — while the identical
   request to /api/webhooks/calcom worked. The router now normalises "cal" to
   "calcom" before the lookup. These two tests pin that, from the router in. */
test("router: /api/webhooks/cal resolves to the calcom adapter, not a 404", async () => {
  _resetOrgCache(); clearHandlers(); _resetRegistered();
  const out = await handleWebhook({
    db: fakeDb(),
    provider: "cal",
    rawBody: bookingBody("BOOKING_CREATED"),
    headers: {},
    url: "https://x/api/webhooks/cal",
    env: {}
  });
  assert.notEqual(out.status, 404, "/api/webhooks/cal must resolve — the alias is missing");
  /* 401, not 200: with no CALCOM_WEBHOOK_SECRET configured the adapter is
     fail-closed by design. Reaching a refusal is the proof it was reached. */
  assert.equal(out.status, 401, "the cal alias must still fail closed with no secret");
});

test("router: a signed webhook through the 'cal' alias behaves exactly like 'calcom'", async () => {
  const raw = bookingBody("MEETING_ENDED");   // recognised body, ignorable trigger
  const call = async (provider) => {
    _resetOrgCache(); clearHandlers(); _resetRegistered();
    return handleWebhook({
      db: fakeDb(),
      provider,
      rawBody: raw,
      headers: { "x-cal-signature-256": sign(raw) },
      url: `https://x/api/webhooks/${provider}`,
      env: { CALCOM_WEBHOOK_SECRET: SECRET }
    });
  };
  const viaAlias = await call("cal");
  const viaCanonical = await call("calcom");
  assert.equal(viaAlias.status, 200);
  assert.equal(viaAlias.body.reason, "ignored:MEETING_ENDED");
  assert.deepEqual(viaAlias.body.emitted, []);
  assert.deepEqual(viaAlias.body, viaCanonical.body, "the alias must not be a second, drifting config");
});

/* --- fail-closed with no secret ---------------------------------------------
   CALCOM_WEBHOOK_SECRET is unset in every environment, because the live
   booking page is ClickFunnels + Cronofy and Cal.com has never had a sender.
   The resulting 401 is the CORRECT output of a correct adapter. These pin it
   so nobody "fixes" the 401 by accepting unsigned bookings. */
test("verifyCalcomSignature: rejects when secret is undefined or empty (fail-closed)", () => {
  const raw = JSON.stringify({ test: 1 });
  assert.equal(verifyCalcomSignature(raw, sign(raw), undefined), false);
  assert.equal(verifyCalcomSignature(raw, sign(raw), ""), false);
});

test("handleCalcomWebhook: no secret configured → 401, nothing emitted", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("booking.created", () => (fired += 1));
  const raw = bookingBody("BOOKING_CREATED");
  const res = await handleCalcomWebhook({
    db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: undefined
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.reason, "bad_signature");
  assert.deepEqual(res.emitted, []);
  assert.equal(fired, 0, "an unsigned Cal.com booking reached the event bus");
});

test("router: an unsigned 'cal' webhook writes NO capture row", async () => {
  _resetOrgCache(); clearHandlers(); _resetRegistered();
  let captures = 0;
  const inner = fakeDb();
  const db = {
    query(sql, params) {
      if (/INSERT INTO webhook_captures/.test(sql)) captures += 1;
      return inner.query(sql, params);
    }
  };
  const out = await handleWebhook({
    db, provider: "cal", rawBody: bookingBody("BOOKING_CREATED"),
    headers: {}, url: "https://x/api/webhooks/cal", env: {}
  });
  assert.equal(out.status, 401);
  assert.equal(captures, 0, "unverified traffic must never be persisted");
});

/* --- PROTOTYPE KEYS MUST NOT BE PROVIDER IDS --------------------------------
   The provider id is a URL segment from an unauthenticated request. Both of the
   router's lookup tables used to be plain object literals, so an id that names
   an Object.prototype member found a truthy value there.

   `POST /api/webhooks/toString` therefore got PAST the router's `if (!cfg)
   return 404` guard holding Object.prototype.toString, then threw TypeError at
   `cfg.fn(...)`; api/webhooks/[provider].mjs catches that and answers 500. And
   `constructor` answered a 404 whose body read "unknown provider: function
   Object() { [native code] }" — engine internals echoed back to whoever asked.

   Every one of these must be an ordinary unknown provider: a clean 404, the id
   repeated back as plain text, no throw, and nothing written. */
test("router: prototype keys are unknown providers — clean 404, never a 500 or a leak", async () => {
  const PROTOTYPE_KEYS = [
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "toLocaleString",
    "propertyIsEnumerable",
    "constructor",
    "__proto__"
  ];

  for (const provider of PROTOTYPE_KEYS) {
    _resetOrgCache(); clearHandlers(); _resetRegistered();
    let captures = 0;
    const inner = fakeDb();
    const db = {
      query(sql, params) {
        if (/INSERT INTO webhook_captures/.test(sql)) captures += 1;
        return inner.query(sql, params);
      }
    };

    let out;
    await assert.doesNotReject(
      async () => { out = await handleWebhook({
        db, provider, rawBody: "{}", headers: {},
        url: `https://x/api/webhooks/${provider}`, env: {}
      }); },
      `provider "${provider}" threw out of the router — the function entry answers that 500`
    );

    assert.equal(out.status, 404, `provider "${provider}" did not answer 404`);
    assert.equal(out.body.ok, false);
    assert.equal(
      out.body.error,
      `unknown provider: ${provider}`,
      `the 404 body for "${provider}" is not the plain id`
    );
    assert.equal(
      /native code|\[object Object\]|function /.test(String(out.body.error)),
      false,
      `the 404 body for "${provider}" leaked engine internals`
    );
    assert.equal(captures, 0, `an unknown provider ("${provider}") was persisted`);
  }
});

/* The same hole, one table further in. PROVIDER_ALIASES is looked up BEFORE the
   adapter table, so a prototype key there decided the provider id before the
   404 guard ever ran — "constructor" resolved to the Object constructor and was
   carried forward as the provider. The alias table must only ever answer for
   aliases it was actually given. */
test("router: the alias table answers for 'cal' and for nothing it did not define", async () => {
  _resetOrgCache(); clearHandlers(); _resetRegistered();
  const viaAlias = await handleWebhook({
    db: fakeDb(), provider: "cal", rawBody: bookingBody("BOOKING_CREATED"),
    headers: {}, url: "https://x/api/webhooks/cal", env: {}
  });
  assert.equal(viaAlias.status, 401, "the real alias must still resolve to the calcom adapter");

  for (const provider of ["hasOwnProperty", "constructor"]) {
    _resetOrgCache(); clearHandlers(); _resetRegistered();
    const out = await handleWebhook({
      db: fakeDb(), provider, rawBody: bookingBody("BOOKING_CREATED"),
      headers: {}, url: `https://x/api/webhooks/${provider}`, env: {}
    });
    assert.equal(out.status, 404, `"${provider}" was resolved by the alias table`);
  }
});
