import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "ai-set-04-3way-handoff.mjs");

test("smash: null / non-object event → no_event, no throw", async () => {
  const db = pgFake({ clients: [] });
  for (const event of [null, undefined, "nope", 7]) {
    const res = await handle({ event, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
  }
  assert.equal(db.messages.length, 0);
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SMASH_SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /vercel\.app/);
});
