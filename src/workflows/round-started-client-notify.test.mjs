import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, SMS_TEMPLATE_KEY } from "./round-started-client-notify.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: round.started sends the client-notify SMS", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "underway", compliance_passed: true }]
  });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.sms.sent, true);
  assert.equal(db.messages.length, 1);
});

test("branch: no resolvable client — no send, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("round.started", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "underway", compliance_passed: true }]
  });
  const event = ev("round.started", {}, { id: "evt-dup-rs", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 1);
});

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "round-started-client-notify.mjs");

test("smash: null / non-object event → no_event, no throw", async () => {
  const db = pgFake({ clients: [] });
  for (const event of [null, undefined, "nope", 7]) {
    const res = await handle({ event, db, step: fakeStep() });
    assert.equal(res.sent, false);
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
