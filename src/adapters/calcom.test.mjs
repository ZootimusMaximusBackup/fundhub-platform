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

// --- canonical mapping -------------------------------------------------------
test("mapToCanonical: BOOKING_CREATED → booking.created", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_CREATED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: BOOKING_RESCHEDULED → booking.created (new time exists)", () => {
  const names = mapToCanonical({ triggerEvent: "BOOKING_RESCHEDULED" }).map((c) => c.name);
  assert.deepEqual(names, ["booking.created"]);
});

test("mapToCanonical: BOOKING_CANCELLED → [] (ignored)", () => {
  assert.deepEqual(mapToCanonical({ triggerEvent: "BOOKING_CANCELLED" }), []);
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
});

test("handleCalcomWebhook: BOOKING_CANCELLED → 200, ignored, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = bookingBody("BOOKING_CANCELLED");
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

test("handleCalcomWebhook: BOOKING_RESCHEDULED dispatches booking.created handler", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("booking.created", (e) => seen.push(e.payload.bookingUid));
  const raw = bookingBody("BOOKING_RESCHEDULED");
  const res = await handleCalcomWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted[0].name, "booking.created");
  assert.deepEqual(seen, ["booking-uid-abc"]);
});
