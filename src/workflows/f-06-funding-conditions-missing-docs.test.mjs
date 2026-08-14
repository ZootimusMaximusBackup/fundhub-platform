import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./f-06-funding-conditions-missing-docs.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "f-06-funding-conditions-missing-docs.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`F-06 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "missing docs email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "missing docs sms", compliance_passed: true }
];

// Round Hold Reason is a CONTACT field under 05/30 (doc 184-190) — the same field C-02
// and C-03 write. This used to go to funding_rounds.hold_reason, where nothing that reads
// the contact field (C-02, C-03, BC-01's path selection) could ever see it.
test("happy path: MISSING_DOCS tags, sets the contact hold reason + next action, and sends", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      templates: withTemplates()
    });
    const res = await handle({ event: ev("mail.response", { classification: "MISSING_DOCS", conditionDescription: "Need bank statements" }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "missing_docs");
    assert.deepEqual(db.clients[0].tags, ["docs:missing"]);
    assert.equal(db.clients[0].custom_fields.round_hold_reason, "Missing Documents");
    assert.equal(db.clients[0].custom_fields.employee_next_action, "Collect Documents");
    assert.equal(db.messages.length, 2);
    assert.equal(calls.length, 0);
  });
});

test("branch: docs.received clears the tag, the hold reason and the condition flag", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["docs:missing"],
        custom_fields: { round_hold_reason: "Missing Documents", funding_condition_required: true } }]
    });
    const res = await handle({ event: ev("docs.received", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "docs_received");
    assert.equal(db.clients[0].tags.includes("docs:missing"), false);
    assert.equal(db.clients[0].custom_fields.round_hold_reason, null);
    // doc 1832 — the old version left this set forever.
    assert.equal(db.clients[0].custom_fields.funding_condition_required, false);
    assert.equal(calls.length, 0);
  });
});

test("docs.received does NOT clobber another workflow's hold reason", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["docs:missing"],
        custom_fields: { round_hold_reason: "Internal Review" } }]
    });
    await handle({ event: ev("docs.received", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(db.clients[0].custom_fields.round_hold_reason, "Internal Review");
    assert.equal(calls.length, 0);
  });
});

test("branch: other classifications on mail.response are ignored", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
    const res = await handle({ event: ev("mail.response", { classification: "APPROVED" }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "not_missing_docs");
    assert.equal(calls.length, 0);
  });
});

test("branch: docs.received does NOT wipe an F-09 Internal Review hold", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [] }],
      fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: "Internal Review" }]
    });
    const res = await handle({ event: ev("docs.received", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "docs_received");
    assert.equal(db.fundingRounds[0].hold_reason, "Internal Review");
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying MISSING_DOCS does not double-send", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      fundingRounds: [{ id: "fr-1", client_id: "cl-1", round_number: 1, hold_reason: null }],
      templates: withTemplates()
    });
    const event = ev("mail.response", { classification: "MISSING_DOCS", conditionDescription: "x" }, { id: "evt-dup-f06", clientId: "cl-1" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.equal(db.messages.length, 2);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client → no throw, no SMS, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    const res = await handle({
      event: ev("mail.response", { classification: "MISSING_DOCS", conditionDescription: "Need bank statements" }, { id: "evt-miss-f06" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event → no_event, no throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const event of [null, undefined, "nope", 7]) {
      const res = await handle({ event, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
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
