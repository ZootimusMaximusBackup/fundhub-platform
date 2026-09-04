import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_TEMPLATE_KEY } from "./ai-set-04-3way-handoff.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

/* A booking is in the future or it is not a booking. These fixtures used to be a
   hard-coded August date that has since slid into the past, which made every one
   of them a test about an appointment that had already happened. */
const inHours = (h) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

test("happy path: sends the handoff SMS + advisor task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const res = await handle({ event: ev("booking.created", { startTime: inHours(3) }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 1);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks[0].assignee_role, "closer");
});

test("branch: no start time — no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_start_time");
});

test("duplicate delivery: replaying does not double-send or double-task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const event = ev("booking.created", { startTime: inHours(3) }, { id: "evt-dup-aiset04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
  assert.equal(db.tasks.length, 1);
});

/* ── F49: the handoff text used to hand the customer a full stop ──────────────
 *
 * Received 2026-09-03: "I've intro'd your advisor so you're not walking in cold
 * — link: ." The template asks for the meeting location; this workflow sent no
 * context, so the tag rendered as nothing.
 */
const HANDOFF_BODY = "Josh here. Your call starts in 15 minutes — link: {{appointment.meeting_location}}. Reply STOP to opt out.";

const handoffTemplates = () => [
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: HANDOFF_BODY, compliance_passed: true }
];

test("F49: the meeting link from the booking is printed in the text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", {
      startTime: inHours(3),
      meetingUrl: "https://meet.google.com/abc-defg-hij"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "payload");
  assert.match(db.messages[0].rendered_body, /https:\/\/meet\.google\.com\/abc-defg-hij/);
  assert.doesNotMatch(db.messages[0].rendered_body, /link: \./);
});

test("F49: with no meeting link anywhere the customer still gets a real one", async () => {
  // ClickFunnels sets meetingUrl null on EVERY booking it takes, so this is the
  // ordinary case, not the edge case.
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(3), meetingUrl: null }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "portal_sign_in");
  const body = db.messages[0].rendered_body;
  assert.doesNotMatch(body, /link: \./);
  assert.match(res.link.url, /^https?:\/\//, "the fallback must be a real web address");
  assert.ok(body.includes(res.link.url), "the resolved link must appear in the text");
});

test("F49: the saved booking row answers when the webhook did not", async () => {
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const db = {
    ...base,
    async query(sql, params) {
      if (/FROM bookings/.test(sql) && /provider_uid/.test(sql)) {
        return { rows: [{ meeting_url: "https://meet.google.com/from-the-row" }] };
      }
      return base.query(sql, params);
    }
  };
  const res = await handle({
    event: ev("booking.created", {
      startTime: inHours(3), meetingUrl: null, bookingUid: "cf-appt-9"
    }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.link.from, "booking_uid");
  assert.match(base.messages[0].rendered_body, /from-the-row/);
});

test("F49: a start time nothing can read sends no handoff text at all", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: "whenever" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "unreadable_start_time");
  assert.equal(db.messages.length, 0);
});

/* ── The clock, not just the date ─────────────────────────────────────────────
 *
 * Round 2 found the other half of F47 living here. This workflow refused a start
 * time nothing could read, but not one that had already gone: a durable sleep
 * set to a moment in the past ends immediately, so a booking carrying yesterday's
 * start time sent "Your call starts in 15 minutes" the instant it arrived.
 */
test("F47b: a booking whose call has already started sends no handoff text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    event: ev("booking.created", { startTime: inHours(-48) }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "appointment_already_started");
  assert.equal(db.messages.length, 0);
  assert.equal(db.tasks.length, 0);
});

test("F47b: a booking taken inside the last fifteen minutes sends no handoff text", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const res = await handle({
    // The call is real and still ahead, but "fifteen minutes before it" is not.
    event: ev("booking.created", { startTime: inHours(0.1) }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "booked_inside_15m");
  assert.equal(db.messages.length, 0);
});

test("F47b: the send moment is decided once, so a replay hours later sends nothing", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: handoffTemplates()
  });
  const startAtMs = Date.now() + 3 * 60 * 60 * 1000;
  const event = ev("booking.created", { startTime: new Date(startAtMs).toISOString() }, { clientId: "cl-1" });

  /* A step shim that records each step's answer by id and hands the same answer
     back on every later pass — which is what Inngest does. Without the plan
     being inside a step, the second pass below would recompute it against a
     clock that is now past the call and refuse a run that had already sent. */
  const memo = new Map();
  const step = {
    run: async (id, fn) => {
      if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify((await fn()) ?? null)));
      return memo.get(id);
    },
    sleep: async () => {},
    sleepUntil: async () => {}
  };

  const first = await handle({ event, db, step, now: () => Date.now() });
  assert.equal(first.done, true);
  assert.equal(db.messages.length, 1);

  // Now drive it again, three hours after the call ended.
  const again = await handle({ event, db, step, now: () => startAtMs + 3 * 60 * 60 * 1000 });
  assert.equal(again.done, true);
  assert.equal(db.messages.length, 1, "the handoff text must not be sent twice");
});
