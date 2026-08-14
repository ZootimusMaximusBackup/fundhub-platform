import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./dpc-02-call-outcome-enforcement.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "dpc-02-call-outcome-enforcement.mjs");

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "showed", pipeline_id: "pl-sales", stage_id: "st-showed" },
    { pipeline_key: "sales", stage_key: "lost", pipeline_id: "pl-sales", stage_id: "st-lost" }
  ]
});

// A booking ending 1 hour from now.
const futureEnd = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`DPC-02 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("sleepUntil is set to appointment end + 5 minutes, not a flat duration", async () => {
  await withFetchTrap(async ({ calls }) => {
    const endTime = futureEnd();
    const expectedWake = new Date(new Date(endTime).getTime() + 5 * 60 * 1000);
    const sleepUntilCalls = [];
    const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
    await handle({ event: ev("booking.created", { endTime }, { clientId: "cl-1" }), db, step });
    assert.equal(sleepUntilCalls.length, 1);
    assert.equal(sleepUntilCalls[0].id, "wait-until-5-min-after-end");
    // Target must be at least endTime + 5m (within 1 second tolerance for test runtime).
    assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expectedWake.getTime()) < 1000,
      `sleepUntil target should be ~endTime+5m, got ${sleepUntilCalls[0].target.toISOString()}`);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("falls back to startTime when endTime absent", async () => {
  await withFetchTrap(async ({ calls }) => {
    const startTime = futureEnd();
    const sleepUntilCalls = [];
    const step = { ...fakeStep(), sleepUntil: async (id, target) => { sleepUntilCalls.push({ id, target }); } };
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
    await handle({ event: ev("booking.created", { startTime }, { clientId: "cl-1" }), db, step });
    assert.equal(sleepUntilCalls.length, 1);
    const expected = new Date(new Date(startTime).getTime() + 5 * 60 * 1000);
    assert.ok(Math.abs(sleepUntilCalls[0].target.getTime() - expected.getTime()) < 1000);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("no appointment time → early exit, no sleep", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
    const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_appointment_time");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("happy path: call happened before the check — moves to showed", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
      events: [{ client_id: "cl-1", name: "call.completed" }],
      ...withStages()
    });
    const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.outcome, "showed");
    assert.equal(db.cards[0].stage_id, "st-showed");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: no call — no-show, tagged, moved to lost", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
    const res = await handle({ event: ev("booking.created", { endTime: futureEnd() }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.outcome, "no_show");
    assert.deepEqual(db.clients[0].tags, ["call:no_show"]);
    assert.equal(db.cards[0].stage_id, "st-lost");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying does not double-move the card", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStages() });
    const event = ev("booking.created", { endTime: futureEnd() }, { id: "evt-dup-dpc02", clientId: "cl-1" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.equal(db.cards.length, 1);
    assert.deepEqual(db.clients[0].tags, ["call:no_show"]);
    assert.equal(db.clients[0].custom_fields.call_outcome, "no_show");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no CRS, no letter pack", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], ...withStages() });
    const res = await handle({
      event: ev("booking.created", { endTime: futureEnd() }, { id: "evt-miss-dpc02" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.cards.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty outcome (null / {} / empty times) → no_appointment_time, no throw, no CRS, no letter pack", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {}, tags: [] }], ...withStages() });
    for (const payload of [null, {}, { endTime: null, startTime: null }, { endTime: "", startTime: "" }]) {
      const res = await handle({
        event: ev("booking.created", payload, { id: `evt-empty-out-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_appointment_time");
    }
    assert.equal(db.cards.length, 0);
    assert.deepEqual(db.clients[0].tags, []);
    assert.equal(db.clients[0].custom_fields.call_outcome, undefined);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], ...withStages() });
    for (const bad of [null, undefined, "booking.created", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(db.cards.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, send letter pack, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bletter.?pack\b/i);
  assert.doesNotMatch(code, /\bdeliverLetters\b/);
  assert.doesNotMatch(code, /\bgenerateDeliverables\b/);
  assert.doesNotMatch(code, /vercel\.app/);
});
