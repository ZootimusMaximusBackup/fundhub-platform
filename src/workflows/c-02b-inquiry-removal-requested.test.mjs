import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./c-02b-inquiry-removal-requested.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "c-02b-inquiry-removal-requested.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`C-02B must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: deposit.paid queues inquiry removal", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const res = await handle({ event: ev("deposit.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.run_inquiry_removal, true);
    assert.deepEqual(db.clients[0].tags, ["inquiry-removal-queued"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying does not duplicate the tag", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev("deposit.paid", {}, { id: "evt-dup-c02b", clientId: "cl-1" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.deepEqual(db.clients[0].tags, ["inquiry-removal-queued"]);
    assert.equal(db.clients[0].custom_fields.run_inquiry_removal, true);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no CRS, no SMS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("deposit.paid", {}, { id: "evt-miss-c02b" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty inquiry payload still queues, no throw, no CRS, no SMS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {}, tags: [] }] });
    for (const payload of [null, {}, { inquiries: [] }, { newInquiries: [] }, { inquiry: null }]) {
      const res = await handle({
        event: ev("deposit.paid", payload, { id: `evt-empty-inq-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, true);
      assert.equal(db.clients[0].custom_fields.run_inquiry_removal, true);
      assert.ok((db.clients[0].tags || []).includes("inquiry-removal-queued"));
    }
    assert.deepEqual(db.clients[0].tags, ["inquiry-removal-queued"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const bad of [null, undefined, "deposit.paid", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, send SMS/mail, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bsms\b/i);
  assert.doesNotMatch(code, /vercel\.app/);
  assert.doesNotMatch(code, /bland/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
});
