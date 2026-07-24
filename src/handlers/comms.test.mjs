import { test } from "node:test";
import assert from "node:assert";
import { onMessageInbound, onCallCompleted, onMailResponse, onBookingCreated } from "./comms.mjs";

// Fake pg covering the queries comms.mjs + resolveClient issue. Messages dedup is
// DB-level (ON CONFLICT) and proven in the pg integration test; the guard-based
// dedup for bank_inbox + tasks lives in app code and IS exercised here.
function pgFake() {
  const clients = [], messages = [], bank = [], tasks = [];
  let n = 0;
  return {
    clients, messages, bank, tasks,
    async query(sql, params = []) {
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
        clients.push({ id, org_id: params[0], email: params[1], phone: params[4] });
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
      if (/SELECT 1 FROM tasks/.test(sql)) {
        return { rows: tasks.find((t) => t.client_id === params[0] && t.body === params[1]) ? [{ x: 1 }] : [] };
      }
      if (/INSERT INTO tasks/.test(sql)) { tasks.push({ org_id: params[0], client_id: params[1], body: params[3] }); return { rows: [] }; }
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
