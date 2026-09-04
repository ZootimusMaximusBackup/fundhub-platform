import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_TEMPLATE_KEY } from "./ai-set-04-3way-handoff.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: sends the handoff SMS + advisor task", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "handoff", compliance_passed: true }]
  });
  const res = await handle({ event: ev("booking.created", { startTime: "2026-08-01T15:00:00Z" }, { clientId: "cl-1" }), db, step: fakeStep() });
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
  const event = ev("booking.created", { startTime: "2026-08-01T15:00:00Z" }, { id: "evt-dup-aiset04", clientId: "cl-1" });
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
      startTime: "2026-08-01T15:00:00Z",
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
    event: ev("booking.created", { startTime: "2026-08-01T15:00:00Z", meetingUrl: null }, { clientId: "cl-1" }),
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
      startTime: "2026-08-01T15:00:00Z", meetingUrl: null, bookingUid: "cf-appt-9"
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
