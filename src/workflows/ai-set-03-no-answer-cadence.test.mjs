import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle, MSG1_KEY, MSG2_KEY, MSG3_KEY } from "./ai-set-03-no-answer-cadence.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "ai-set-03-no-answer-cadence.mjs");

const withTemplates = () => [MSG1_KEY, MSG2_KEY, MSG3_KEY].map((k) => ({ org_id: "org-1", template_key: k, channel: "sms", body: k, compliance_passed: true }));

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`AI-SET-03 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: full cadence sends all 3 messages when never rebooked", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", { disposition: "no_answer" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.exitedAt, "completed");
  assert.equal(db.messages.length, 3);
});

test("branch: rebooking after msg1 stops the cadence early", async () => {
  const clients = [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }];
  const events = [];
  const db = pgFake({ clients, events, templates: withTemplates() });
  let sleeps = 0;
  const step = { run: (_id, fn) => fn(), sleep: async () => { sleeps += 1; if (sleeps === 1) events.push({ client_id: "cl-1", name: "booking.created" }); } };
  const res = await handle({ event: ev("call.completed", { disposition: "no_answer" }, { clientId: "cl-1" }), db, step });
  assert.equal(res.exitedAt, "after-msg1");
  assert.equal(db.messages.length, 1);
});

test("branch: answered calls are ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { disposition: "transferred" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying does not double-send", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
    const event = ev("call.completed", { disposition: "no_answer" }, { id: "evt-dup-aiset03", clientId: "cl-1" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.equal(db.messages.length, 3);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    const res = await handle({
      event: ev("call.completed", { disposition: "no_answer" }, { id: "evt-miss-aiset03" }),
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

test("smash: empty / missing disposition does not throw, no SMS queue, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      templates: withTemplates()
    });
    for (const payload of [null, {}, { disposition: null }, { disposition: "" }, { disposition: "   " }]) {
      const res = await handle({
        event: ev("call.completed", payload, { id: `evt-empty-disp-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, false);
      assert.equal(res.reason, "not_no_answer");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], templates: withTemplates() });
    for (const bad of [null, undefined, "call.completed", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate cadence keeps three queued SMS, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
    const event = ev("call.completed", { disposition: "voicemail" }, { id: "evt-dup-aiset03-voicemail", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.exitedAt, "completed");
    assert.equal(second.done, true);
    assert.equal(second.exitedAt, "completed");
    assert.equal(db.messages.length, 3);
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
