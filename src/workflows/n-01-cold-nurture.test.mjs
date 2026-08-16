import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./n-01-cold-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "n-01-cold-nurture.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`N-01 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Cold nurture email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Cold nurture sms body", compliance_passed: true }
];

test("happy path: cold lead (entry.captured only) gets email + sms", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", { clientId: "cl-1" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(res.email.sent, true);
  assert.equal(res.sms.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: lead who already submitted the survey is warm, not cold — no send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [
      { client_id: "cl-1", name: "entry.captured" },
      { client_id: "cl-1", name: "survey.submitted" }
    ],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_cold:warm");
  assert.equal(db.messages.length, 0);
});

test("branch: no client resolvable — no send, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("entry.captured", {}), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_client");
});

test("branch: template not yet seeded — send is a safe no-op, never invents copy", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: []
  });
  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true, "still a 'sent' attempt at the workflow level");
  assert.equal(res.email.sent, false);
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

// End-to-end merge-tag proof through a real workflow. The unit-level coverage lives in
// messaging.test.mjs and render-template.test.mjs; this asserts the whole path a live
// send actually takes — workflow → sendTemplated → client record → renderTemplate →
// messages.rendered_body — because that is where the bug was visible: real GHL copy is
// written in `{{contact.*}}` tags and every outbound body carried them literally.
//
// The shared pgFake has no branch for sendTemplated's client-context query, so it's
// decorated locally rather than edited in test-support.mjs (other sessions are in there).
const withClientContext = (db, row) => ({
  ...db,
  async query(sql, params = []) {
    if (/SELECT first_name, last_name, email, phone, custom_fields FROM clients/.test(sql)) {
      return { rows: params[0] === row.id ? [row] : [] };
    }
    return db.query(sql, params);
  }
});

test("REGRESSION: a real workflow send renders {{contact.*}} — no literal braces reach the message row", async () => {
  const base = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: [
      { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Hi {{contact.first_name}}, your {{contact.analyzer_prequal_amount}} pre-approval is ready.", compliance_passed: true },
      { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Hey {{contact.first_name}} — {{contact.business_name}}?", compliance_passed: true }
    ]
  });
  const db = withClientContext(base, {
    id: "cl-1", first_name: "Dana", last_name: "Reyes", email: "a@b.com", phone: "+15550000",
    custom_fields: { analyzer_prequal_amount: 50000, business_name: "Reyes Haulage" }
  });

  const res = await handle({ event: ev("entry.captured", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  const bodies = base.messages.map((m) => m.rendered_body);
  assert.deepEqual(bodies, [
    "Hi Dana, your 50000 pre-approval is ready.",
    "Hey Dana — Reyes Haulage?"
  ]);
  for (const b of bodies) assert.ok(!b.includes("{{"), `unrendered merge tag reached an outbound body: ${b}`);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    events: [{ client_id: "cl-1", name: "entry.captured" }],
    templates: withTemplates()
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-1", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() }); // replay
  assert.equal(db.messages.length, 2, "one email + one sms, not four");
});

// --- S-N01 smash: null event / missing client / duplicate / fetch trap / source grep ---

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    const res = await handle({
      event: ev("entry.captured", {}, { id: "evt-miss-n01" }),
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
      events: [{ client_id: "cl-1", name: "entry.captured" }],
      templates: withTemplates()
    });
    for (const bad of [null, undefined, "entry.captured", 42]) {
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
      events: [{ client_id: "cl-1", name: "entry.captured" }],
      templates: withTemplates()
    });
    const event = ev("entry.captured", {}, { id: "evt-dup-n01-smash", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.sent, true);
    assert.equal(second.sent, true);
    // sendTemplated still reports sent:true on replay; the fence is the row count.
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
