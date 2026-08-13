import { test } from "node:test";
import assert from "node:assert";
import {
  onMessageInbound, onCallCompleted, onMailResponse, onBookingCreated,
  onBookingRescheduled, onBookingCancelled, onBookingNoshow
} from "./comms.mjs";

// Fake pg covering the queries comms.mjs + resolveClient issue. Messages dedup is
// DB-level (ON CONFLICT) and proven in the pg integration test; the guard-based
// dedup for bank_inbox + tasks lives in app code and IS exercised here.
function pgFake() {
  const clients = [], messages = [], bank = [], tasks = [], optOuts = [];
  let n = 0;
  return {
    clients, messages, bank, tasks, optOuts,
    async query(sql, params = []) {
      // opt_outs support (TCPA STOP/START handling)
      if (/INSERT INTO opt_outs/.test(sql)) {
        const existing = optOuts.find((r) => r.client_id === params[0] && r.channel === params[2]);
        if (existing) { existing.opted_in_at = null; existing.source = params[3]; }
        else optOuts.push({ client_id: params[0], org_id: params[1], channel: params[2], source: params[3], opted_in_at: null });
        return { rows: [] };
      }
      if (/UPDATE opt_outs SET opted_in_at/.test(sql)) {
        const r = optOuts.find((r) => r.client_id === params[0] && r.channel === params[1]);
        if (r) r.opted_in_at = new Date();
        return { rows: [] };
      }
      if (/SELECT 1 FROM opt_outs/.test(sql)) {
        const r = optOuts.find((r) => r.client_id === params[0] && r.channel === params[1] && !r.opted_in_at);
        return { rows: r ? [{ 1: 1 }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql) && /lower\(email\)/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && String(c.email || "").toLowerCase() === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/SELECT id FROM clients/.test(sql) && /phone=\$2/.test(sql)) {
        const c = clients.find((c) => c.org_id === params[0] && c.phone === params[1]);
        return { rows: c ? [{ id: c.id }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        if (clients.find((c) => c.org_id === params[0] && String(c.email || "").toLowerCase() === String(params[1]).toLowerCase())) return { rows: [] };
        const id = "cl-" + ++n;
        clients.push({ id, org_id: params[0], email: params[1], phone: params[4], tags: [], custom_fields: {} });
        return { rows: [{ id }] };
      }
      if (/INSERT INTO messages/.test(sql)) { messages.push({ sql, params }); return { rows: [] }; }
      if (/SELECT 1 FROM bank_inbox/.test(sql)) {
        return { rows: bank.find((b) => b.org_id === params[0] && b.__event_id === String(params[1])) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO bank_inbox/.test(sql)) {
        const raw = JSON.parse(params[5]);
        bank.push({ org_id: params[0], client_id: params[1], classification: params[2], __event_id: raw.__event_id });
        return { rows: [] };
      }
      // --- clients.tags add (addTags, mirrors src/workflows/tags.mjs) ---
      if (/UPDATE clients SET tags = array\(SELECT DISTINCT unnest\(tags \|\|/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.tags = Array.from(new Set([...(c.tags || []), ...params[1]]));
        return { rows: [] };
      }
      // --- clients.custom_fields merge (mergeCustomFields, mirrors src/workflows/custom-fields.mjs) ---
      if (/UPDATE clients SET custom_fields/.test(sql)) {
        const c = clients.find((c) => c.id === params[0]);
        if (c) c.custom_fields = { ...(c.custom_fields || {}), ...JSON.parse(params[1]) };
        return { rows: [] };
      }
      // --- tasks: reschedule update (RETURNING id when an open row matches) ---
      if (/UPDATE tasks[\s\S]*SET[\s\S]*due_at = COALESCE/.test(sql)) {
        const [clientId, uid, dueAt, meetingUrl] = params;
        const t = tasks.find((t) => t.client_id === clientId && t.source_workflow === "calcom" && t.body === uid);
        if (!t) return { rows: [] };
        t.due_at = dueAt ?? t.due_at;
        t.meeting_url = meetingUrl ?? t.meeting_url;
        t.title = "Strategy session rescheduled";
        t.done = false;
        return { rows: [{ id: t.id }] };
      }
      // --- tasks: cancel/no-show close-out (mark the open task done) ---
      if (/UPDATE tasks SET done = true/.test(sql)) {
        const [clientId, uid] = params;
        const t = tasks.find((t) => t.client_id === clientId && t.source_workflow === "calcom" && t.body === uid && !t.done);
        if (t) t.done = true;
        return { rows: [] };
      }
      if (/SELECT 1 FROM tasks/.test(sql)) {
        return { rows: tasks.find((t) => t.client_id === params[0] && t.body === params[1]) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) {
        const row = {
          id: "task-" + (tasks.length + 1),
          org_id: params[0], client_id: params[1], title: params[2], body: params[3],
          due_at: params[4], source_workflow: params[5], meeting_url: params[8] ?? null,
          done: false
        };
        tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      return { rows: [] };
    }
  };
}

const ev = (name, payload, extra = {}) => ({ id: "evt-x", orgId: "org-1", name, payload, ...extra });

test("message.inbound: logs an sms message, linked to client by phone", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "hi", sid: "SM1", channel: "sms", source: "twilio" }), db);
  assert.equal(db.messages.length, 1);
  assert.match(db.messages[0].sql, /'inbound'/);
  assert.equal(db.messages[0].params[1], "cl-1", "linked to the client by phone");
});

test("call.completed: logs a voice message row", async () => {
  const db = pgFake();
  await onCallCompleted(ev("call.completed", { callId: "call_1", status: "completed", disposition: "transferred", source: "bland" }, { clientId: "cl-9" }), db);
  assert.equal(db.messages.length, 1);
  assert.match(db.messages[0].sql, /'voice'/);
  assert.equal(db.messages[0].params[1], "cl-9");
});

test("mail.response: inserts bank_inbox once, replay guard skips the second", async () => {
  const db = pgFake();
  const e = ev("mail.response", { from: "bank@lender.com", subject: "Approved", classification: "APPROVED", source: "mailgun" }, { id: "evt-mail-1" });
  await onMailResponse(e, db);
  await onMailResponse(e, db);
  assert.equal(db.bank.length, 1);
  assert.equal(db.bank[0].classification, "APPROVED");
});

test("booking.created: creates a task once (dedup by booking uid), creates client from email", async () => {
  const db = pgFake();
  const e = ev("booking.created", { email: "lead@x.com", name: "Lead Person", bookingUid: "bk_1", startTime: "2026-08-01T15:00:00Z", source: "calcom" });
  await onBookingCreated(e, db);
  await onBookingCreated(e, db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].body, "bk_1");
  assert.equal(db.clients.length, 1, "resolved+created the client from the booking email");
});

test("booking.created: stores meetingUrl on the task", async () => {
  const db = pgFake();
  const e = ev("booking.created", {
    email: "meet@x.com", name: "Meet Person", bookingUid: "bk_meet", startTime: "2026-08-01T15:00:00Z",
    source: "calcom", meetingUrl: "https://meet.example.com/abc"
  });
  await onBookingCreated(e, db);
  assert.equal(db.tasks[0].meeting_url, "https://meet.example.com/abc");
});

// booking.rescheduled — updates the existing task in place (no second task).
test("booking.rescheduled: updates the existing open task's due_at + meeting_url in place", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "resched@x.com", bookingUid: "bk_2", startTime: "2026-08-01T15:00:00Z", source: "calcom" });
  await onBookingCreated(created, db);
  const rescheduled = ev("booking.rescheduled", {
    clientId: db.clients[0].id, bookingUid: "bk_2", startTime: "2026-08-02T15:00:00Z",
    meetingUrl: "https://meet.example.com/new", source: "calcom"
  }, { clientId: db.clients[0].id });
  await onBookingRescheduled(rescheduled, db);
  assert.equal(db.tasks.length, 1, "no second task created — the open one was updated");
  assert.equal(db.tasks[0].due_at, "2026-08-02T15:00:00Z");
  assert.equal(db.tasks[0].meeting_url, "https://meet.example.com/new");
  assert.equal(db.tasks[0].title, "Strategy session rescheduled");
  assert.equal(db.clients[0].custom_fields.call_outcome, "rescheduled");
});

test("booking.rescheduled: no open task found → creates one (rescheduled before created seen)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-resched", org_id: "org-1", email: "noopen@x.com", tags: [], custom_fields: {} });
  const e = ev("booking.rescheduled", { clientId: "cl-resched", bookingUid: "bk_3", startTime: "2026-08-03T15:00:00Z", source: "calcom" }, { clientId: "cl-resched" });
  await onBookingRescheduled(e, db);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].body, "bk_3");
  assert.equal(db.clients[0].custom_fields.call_outcome, "rescheduled");
});

// booking.cancelled — closes the open task, tags, sets custom field. No re-nurture task.
test("booking.cancelled: marks the open task done, tags call:cancelled, sets call_outcome", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "cancel@x.com", bookingUid: "bk_4", startTime: "2026-08-01T15:00:00Z", source: "calcom" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const cancelled = ev("booking.cancelled", { clientId, bookingUid: "bk_4", source: "calcom" }, { clientId });
  await onBookingCancelled(cancelled, db);
  assert.equal(db.tasks[0].done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:cancelled"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "cancelled");
});

test("booking.cancelled: replay is idempotent (task stays done, tag not duplicated)", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "cancel2@x.com", bookingUid: "bk_5", startTime: "2026-08-01T15:00:00Z", source: "calcom" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const cancelled = ev("booking.cancelled", { clientId, bookingUid: "bk_5", source: "calcom" }, { clientId });
  await onBookingCancelled(cancelled, db);
  await onBookingCancelled(cancelled, db);
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:cancelled"]);
});

// booking.noshow — closes the open task, tags call:no_show, sets call_outcome.
test("booking.noshow: marks the open task done, tags call:no_show, sets call_outcome", async () => {
  const db = pgFake();
  const created = ev("booking.created", { email: "noshow@x.com", bookingUid: "bk_6", startTime: "2026-08-01T15:00:00Z", source: "calcom" });
  await onBookingCreated(created, db);
  const clientId = db.clients[0].id;
  const noshow = ev("booking.noshow", { clientId, bookingUid: "bk_6", source: "calcom" }, { clientId });
  await onBookingNoshow(noshow, db);
  assert.equal(db.tasks[0].done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked", "call:no_show"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "no_show");
});

// TCPA STOP/START keyword handling

test("message.inbound STOP: records opt-out for known client", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "STOP", sid: "SM2", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 1);
  assert.equal(db.optOuts[0].client_id, "cl-1");
  assert.equal(db.optOuts[0].channel, "sms");
  assert.equal(db.optOuts[0].opted_in_at, null);
});

test("message.inbound STOPALL: also records opt-out (case-insensitive)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-2", org_id: "org-1", phone: "+15550000001" });
  await onMessageInbound(ev("message.inbound", { from: "+15550000001", body: "stopall", sid: "SM3", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 1);
});

test("message.inbound START: sets opted_in_at (resumes after prior STOP)", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  // First opt out
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "STOP", sid: "SM4", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts[0].opted_in_at, null, "opted out");
  // Then opt back in
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "START", sid: "SM5", channel: "sms", source: "twilio" }), db);
  assert.notEqual(db.optOuts[0].opted_in_at, null, "opted back in");
});

test("message.inbound: non-STOP body does not create opt-out row", async () => {
  const db = pgFake();
  db.clients.push({ id: "cl-1", org_id: "org-1", phone: "+15551234567" });
  await onMessageInbound(ev("message.inbound", { from: "+15551234567", body: "Hello there!", sid: "SM6", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 0);
  assert.equal(db.messages.length, 1, "normal message still logged");
});

test("message.inbound STOP: unknown sender (no client match) does not crash", async () => {
  const db = pgFake();
  // No clients seeded — should resolve clientId to null and skip opt-out silently
  await onMessageInbound(ev("message.inbound", { from: "+19999999999", body: "STOP", sid: "SM7", channel: "sms", source: "twilio" }), db);
  assert.equal(db.optOuts.length, 0);
});
