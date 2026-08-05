import { test } from "node:test";
import assert from "node:assert";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./s-05a-no-show-recovery.mjs";

function fakeStep() {
  return { run: (_id, fn) => fn() };
}

function fakeDb({ clientId = "cl-1" } = {}) {
  const tags = [];
  const tasks = [];
  const messages = [];
  return {
    tags, tasks, messages,
    query(sql, params) {
      if (/FROM clients/i.test(sql) && /email/i.test(sql)) {
        return { rows: clientId ? [{ id: clientId }] : [] };
      }
      if (/INSERT INTO clients/i.test(sql)) return { rows: [{ id: clientId }] };
      if (/UPDATE clients SET tags/i.test(sql) || /custom_fields/i.test(sql)) {
        if (Array.isArray(params?.[1])) tags.push(...params[1]);
        return { rows: [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const row = { id: `task-${tasks.length + 1}` };
        tasks.push(row);
        return { rows: [row] };
      }
      if (/SELECT id FROM tasks/i.test(sql)) return { rows: [] };
      if (/message_templates|INSERT INTO messages/i.test(sql)) {
        messages.push(params);
        return { rows: [{ id: `msg-${messages.length}` }] };
      }
      return { rows: [] };
    }
  };
}

test("s-05a: no client → done false", async () => {
  const db = fakeDb({ clientId: null });
  db.query = async () => ({ rows: [] });
  const res = await handle({
    event: { id: "e1", orgId: "org-1", payload: { email: "missing@x.com" } },
    db,
    step: fakeStep()
  });
  assert.equal(res.done, false);
});

test("s-05a: tags, templates keys, recovery task", async () => {
  const db = fakeDb();
  const res = await handle({
    event: { id: "e2", orgId: "org-1", clientId: "cl-1", payload: { bookingUid: "b1" } },
    db,
    step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(EMAIL_TEMPLATE_KEY, "EMAIL-S05A-NOSHOW-RECOVERY");
  assert.equal(SMS_TEMPLATE_KEY, "SMS-S05A-NOSHOW-RECOVERY");
});
