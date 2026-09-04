import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H } from "./s-04b-booking-reminders.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { BOOKING_CONFIRM_LINK_TTL_MINUTES } from "../auth/magic-link.mjs";

const portalStub = async () => ({
  ok: true, outcome: "issued", token: "booking-portal-tok", sent: false
});

const sms = () => [
  { org_id: "org-1", template_key: SMS_CONFIRM, channel: "sms", body: "confirm {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_24H, channel: "sms", body: "24h {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_REMIND_2H, channel: "sms", body: "2h {{appointment.start_time}}", compliance_passed: true },
  { org_id: "org-1", template_key: EMAIL_CONFIRM, channel: "email", subject: "You're booked", body: "confirmed for {{appointment.start_time}}. Here is your link to sign in to your Fundhub portal: {{magic_link.url}}", compliance_passed: true }
];

test("s-04b: confirm + both reminders when startTime present", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  assert.equal(db.messages.length, 4);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM, SMS_REMIND_24H, SMS_REMIND_2H]);
  assert.equal(res.stoppedBecause, undefined);
});

test("s-04b: only confirm when no startTime", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms()
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
  assert.equal(res.skippedReminders, "no_start_time");
});

test("s-04b: confirm SMS prints a human time, not raw ISO-Z", async () => {
  const iso = "2026-08-23T02:49:58.390Z";
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: iso }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  const confirm = db.messages.find((m) => m.template_key === SMS_CONFIRM);
  assert.ok(confirm);
  assert.doesNotMatch(confirm.rendered_body, /2026-08-23T02:49:58/);
  assert.match(confirm.rendered_body, /Aug/);
});

test("s-04b: stops before 24h reminder if call already held", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: sms(),
    events: [{ client_id: "cl-1", name: "call.completed" }]
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  assert.equal(res.stoppedBecause, "call_held");
  assert.equal(db.messages.length, 2);
  assert.deepEqual(db.messages.map((m) => m.template_key), [SMS_CONFIRM, EMAIL_CONFIRM]);
});

test("s-04b: booked stage sends exactly one text and one email, immediately", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z" }, { clientId: "cl-1" }),
    db, step: fakeStep(), requestMagicLinkImpl: portalStub
  });
  const immediate = db.messages.slice(0, 2);
  assert.equal(immediate.filter((m) => m.channel === "sms").length, 1);
  assert.equal(immediate.filter((m) => m.channel === "email").length, 1);
});

test("s-04b: confirm email carries a 365-day portal token and does not queue EMAIL-PORTAL-MAGIC-LINK", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  const calls = [];
  await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z", email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    requestMagicLinkImpl: async (_db, args) => {
      calls.push(args);
      return { ok: true, outcome: "issued", token: "booking-portal-tok", sent: false };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queueEmail, false);
  assert.equal(calls[0].ttlMinutes, BOOKING_CONFIRM_LINK_TTL_MINUTES);
  assert.ok(!db.messages.some((m) => m.template_key === "EMAIL-PORTAL-MAGIC-LINK"));
  const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
  assert.ok(email);
  assert.match(email.rendered_body, /portal-login\.html\?t=booking-portal-tok/);
  assert.match(email.rendered_body, /Here is your link to sign in to your Fundhub portal/);
});

test("s-04b: no token still puts a real sign-in link in the confirm email", async () => {
  // Walk finding F2, 2026-09-03. The magic_link context used to be spread in
  // only when a token existed, and renderTemplate replaces an absent tag with
  // the empty string — so the email said "Here is your link to sign in to your
  // Fundhub portal:" and then showed <a href=""></a>. The client was told to
  // click something that was not there.
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: sms()
  });
  await handle({
    event: ev("booking.created", { startTime: "2026-08-20T18:00:00Z", email: "a@b.com" }, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    // Every shape that yields no token: an outright refusal, the rate limiter,
    // and an address that matched nobody.
    requestMagicLinkImpl: async () => ({ ok: true, limited: false, outcome: "no_account" })
  });
  const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
  assert.ok(email);
  assert.doesNotMatch(email.rendered_body, /href=""/);
  assert.match(email.rendered_body, /portal-login\.html/);
  assert.doesNotMatch(email.rendered_body, /\{\{magic_link/);
});

test("s-04b: a refused or rate-limited link request still ships the sign-in page", async () => {
  for (const stub of [
    async () => ({ ok: false, error: "email_required" }),
    async () => ({ ok: true, limited: true, retryAfterMinutes: 15 })
  ]) {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      templates: sms()
    });
    await handle({
      event: ev("booking.created", {}, { clientId: "cl-1" }),
      db, step: fakeStep(), requestMagicLinkImpl: stub
    });
    const email = db.messages.find((m) => m.template_key === EMAIL_CONFIRM);
    assert.ok(email);
    assert.match(email.rendered_body, /portal-login\.html/);
    assert.doesNotMatch(email.rendered_body, /href=""/);
  }
});

test("s-04b listens to booking.created and booking.rescheduled", async () => {
  const { s04bBookingReminders } = await import("./s-04b-booking-reminders.mjs");
  const names = (s04bBookingReminders.opts.triggers || []).map((t) => t.event).sort();
  assert.deepEqual(names, ["booking.created", "booking.rescheduled"]);
});

function assertCancelsThisBooking(fn) {
  const rows = (fn.opts.cancelOn || []).filter((c) => c.event === "booking.cancelled");
  assert.ok(rows.length >= 1, `${fn.opts.id} must stop on booking.cancelled`);
  assert.ok(
    rows.some((c) => /payload\.bookingUid/.test(c.if) && /async\.data\.payload\.bookingUid/.test(c.if)),
    `${fn.opts.id} must match this booking's id, not every client`
  );
}

test("cancel-cancels-runs: booking.cancelled stops this booking's in-flight jobs only", async () => {
  const { s04bBookingReminders } = await import("./s-04b-booking-reminders.mjs");
  const { bs01PrecallLauncher } = await import("./bs-01-precall-launcher.mjs");
  const { aiSet043WayHandoff } = await import("./ai-set-04-3way-handoff.mjs");
  const { dpc05NoProgressEscalation } = await import("./dpc-05-no-progress-escalation.mjs");
  const { aiSet01JoshSetter } = await import("./ai-set-01-josh-setter.mjs");
  for (const fn of [
    s04bBookingReminders,
    bs01PrecallLauncher,
    aiSet043WayHandoff,
    dpc05NoProgressEscalation,
    aiSet01JoshSetter
  ]) {
    assertCancelsThisBooking(fn);
  }
});

