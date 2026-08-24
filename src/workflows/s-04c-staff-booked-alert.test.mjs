import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./s-04c-staff-booked-alert.mjs";
import { fakeStep, ev } from "./test-support.mjs";

test("no client means no staff text", async () => {
  const db = {
    async query(sql) {
      if (/FROM clients/.test(sql) || /INSERT INTO clients/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const res = await handle({
    event: ev("booking.created", { email: "" }, { clientId: null }),
    db,
    step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
});

test("queues staff alerts after the client is found", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push(sql);
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ body: "{{alert_body}}", compliance_passed: true }] };
      }
      if (/FROM staff/.test(sql)) {
        return { rows: [{ id: "st-1", role: "owner", phone: "555", notify_booked_call_sms: true }] };
      }
      if (/FROM clients/.test(sql) && /custom_fields/.test(sql)) {
        return { rows: [{ first_name: "Ada", last_name: "L", email: "a@b.c", phone: "1", channel_source: "website:home", custom_fields: {} }] };
      }
      if (/INSERT INTO messages/.test(sql)) return { rows: [{ id: "m1" }] };
      if (/SELECT id, ghl_contact_id FROM clients/.test(sql) || /INSERT INTO clients/.test(sql)) {
        return { rows: [{ id: params[0] || "cl-1" }] };
      }
      return { rows: [{ id: "cl-1" }] };
    }
  };
  const res = await handle({
    event: ev("booking.created", { email: "a@b.c", startTime: "2026-08-25T21:00:00Z" }, { clientId: "cl-1" }),
    db,
    step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.queued, 1);
});
