import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./n-04-post-funding-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Post-funding email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Post-funding sms body", compliance_passed: true }
];

test("happy path: round.funded sends the post-funding touch", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("round.funded", { amount: 25000 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: no resolvable client — no send, no throw", async () => {
  const db = pgFake({ templates: withTemplates() });
  const res = await handle({ event: ev("round.funded", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_client");
});

test("branch: template not yet seeded — safe no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: [] });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.funded", {}, { id: "evt-dup-4", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});

test("distinct rounds (different event ids) each send their own touch", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  await handle({ event: ev("round.funded", {}, { id: "evt-round-1", clientId: "cl-1" }), db, step: fakeStep() });
  await handle({ event: ev("round.funded", {}, { id: "evt-round-2", clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(db.messages.length, 4, "two rounds funded, two touches each");
});

const SMASH_SRC = join(dirname(fileURLToPath(import.meta.url)), "n-04-post-funding-nurture.mjs");

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
