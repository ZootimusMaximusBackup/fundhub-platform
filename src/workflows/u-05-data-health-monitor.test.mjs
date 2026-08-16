import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./u-05-data-health-monitor.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "u-05-data-health-monitor.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`U-05 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: complete fields clear any incomplete tag", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["analyzer:data-incomplete"] }] });
    const res = await handle({
      event: ev("analysis.completed", { scores: { ex: 640 }, utilization: 0.3 }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.healthy, true);
    assert.equal(db.clients[0].tags.includes("analyzer:data-incomplete"), false);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: missing critical fields tags incomplete + creates a task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const res = await handle({
      event: ev("analysis.completed", { scores: {} }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.healthy, false);
    assert.equal(res.task.created, true);
    assert.deepEqual(db.clients[0].tags, ["analyzer:data-incomplete"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("empty payload: null / {} / missing utilization — tag + task, no throw, no pull, no email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [] }] });
    for (const payload of [null, {}, { scores: { ex: 700 } }, { utilization: 0.2 }, { scores: { ex: null, eq: null, tu: null }, utilization: null }]) {
      const res = await handle({
        event: ev("analysis.completed", payload, { id: `evt-empty-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db, step: fakeStep()
      });
      assert.equal(res.done, true);
      assert.equal(res.healthy, false);
      assert.equal(res.task.created, true);
      assert.ok((db.clients[0].tags || []).includes("analyzer:data-incomplete"));
    }
    // One incomplete tag (DISTINCT), five mapping tasks (distinct event ids).
    assert.deepEqual(db.clients[0].tags, ["analyzer:data-incomplete"]);
    assert.equal(db.tasks.length, 5);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw, does not pull, does not email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { scores: { ex: 650 }, utilization: 0.1 }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(db.tasks.length, 0);
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

test("duplicate delivery: replaying does not double-create the mapping task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [] }] });
    const event = ev("analysis.completed", { scores: {} }, { id: "evt-dup-u05", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.healthy, false);
    assert.equal(first.task.created, true);
    assert.equal(second.done, true);
    assert.equal(second.healthy, false);
    assert.equal(second.task.created, false);
    assert.equal(db.tasks.length, 1);
    assert.deepEqual(db.clients[0].tags, ["analyzer:data-incomplete"]);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, send mail, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /vercel\.app/);
});
