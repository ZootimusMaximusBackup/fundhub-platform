import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./c-02-inquiry-created.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "c-02-inquiry-created.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`C-02 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: new inquiries logged, hold + tags set, task created", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { newInquiries: [{ bureau: "EX", inquiry: "Bank A" }, { bureau: "TU", inquiry: "Bank B" }] }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.logged, 2);
    assert.equal(db.inquiryLog.length, 2);
    assert.equal(db.clients[0].custom_fields.round_hold_reason, "New Inquiries");
    assert.deepEqual(db.clients[0].tags.sort(), ["inquiry:pending", "ops:action-required"]);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: no new inquiries — no-op", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_new_inquiries");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("empty payload: null / {} / empty or null newInquiries — no-op, no throw, no pull, no SMS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    for (const payload of [null, {}, { newInquiries: [] }, { newInquiries: null }, { scores: { ex: 700 } }]) {
      const res = await handle({
        event: ev("analysis.completed", payload, { id: `evt-empty-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db, step: fakeStep()
      });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_new_inquiries");
    }
    assert.equal(db.inquiryLog.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw, does not pull, does not SMS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { newInquiries: [{ bureau: "EX", inquiry: "Bank A" }] }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.inquiryLog.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("null event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({ event: null, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying does not re-log the same inquiries or re-create the task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev("analysis.completed", { newInquiries: [{ bureau: "EX", inquiry: "Bank A" }] }, { id: "evt-dup-c02", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.task.created, true);
    assert.equal(second.done, true);
    assert.equal(second.task.created, false);
    assert.equal(db.inquiryLog.length, 1);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
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
});
