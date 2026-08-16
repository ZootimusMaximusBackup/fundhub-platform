import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-03-round-submitted.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "f-03-round-submitted.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`F-03 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Round submitted email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Round submitted sms", compliance_passed: true }
];

test("happy path: round.submitted with a round number sends email + sms", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", { roundNumber: 3 }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Remove Inquiries");
});

test("branch: missing round number exits without sending", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("round.submitted", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_round_number");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.submitted", { roundNumber: 1 }, { id: "evt-dup-f03", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});

// --- F-03 smash: null event / missing client / duplicate / fetch trap / source grep ---

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    const res = await handle({
      event: ev("round.submitted", { roundNumber: 2 }, { id: "evt-miss-f03" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.sent, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      templates: withTemplates()
    });
    for (const bad of [null, undefined, "round.submitted", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.sent, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate replay keeps one email + one sms, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      templates: withTemplates()
    });
    const event = ev("round.submitted", { roundNumber: 1 }, { id: "evt-dup-f03-smash", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.sent, true);
    assert.equal(second.sent, true);
    assert.equal(db.messages.length, 2, "one email + one sms; replay must not double");
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bdrain(All)?\s*\(/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /outbox\.mjs/);
  assert.doesNotMatch(code, /vercel\.app/);
  assert.doesNotMatch(code, /bland/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
});
