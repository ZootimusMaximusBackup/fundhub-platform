import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./c-05-pre-funding-review.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "c-05-pre-funding-review.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`C-05 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: CRS complete raises the review task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "FULL_FUNDING",
        custom_fields: { crs_status: "Complete" }
      }]
    });
    const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "review");
    assert.equal(res.done, true);
    assert.equal(res.task.created, true);
    assert.equal(db.clients[0].custom_fields.employee_next_action, "Review Funding File");
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: CRS incomplete flags awaiting-CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "FUNDING_PLUS_REPAIR",
        custom_fields: {}
      }]
    });
    const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "awaiting_crs");
    assert.deepEqual(db.clients[0].tags, ["ops:action-required"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "FULL_FUNDING",
        custom_fields: { crs_status: "Complete" }
      }]
    });
    const event = ev("round.started", {}, { id: "evt-dup-c05", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.task.created, true);
    assert.equal(second.task.created, false);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no task, no pack, no fetch", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("round.started", {}),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({ event: null, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: MANUAL_REVIEW is not funding — no review task, no pack, no CRS pull", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "MANUAL_REVIEW",
        custom_fields: { crs_status: "Complete" }
      }]
    });
    const res = await handle({
      event: ev("round.started", {}, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.branch, "not_funding");
    assert.equal(res.outcomeTier, "MANUAL_REVIEW");
    assert.ok(String(res.reason).startsWith("not_funding_path:"));
    assert.equal(db.tasks.length, 0);
    assert.notEqual(db.clients[0].custom_fields.employee_next_action, "Review Funding File");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: funding path still reviews when CRS complete (vs MANUAL_REVIEW)", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "PREMIUM_STACK",
        custom_fields: { crs_status: "Complete" }
      }]
    });
    const res = await handle({
      event: ev("round.started", {}, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(res.branch, "review");
    assert.equal(db.clients[0].custom_fields.employee_next_action, "Review Funding File");
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: MANUAL_REVIEW with incomplete CRS still does not enter funding hold path", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        outcome_tier: "MANUAL_REVIEW",
        custom_fields: {}
      }]
    });
    const res = await handle({
      event: ev("round.started", {}, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.branch, "not_funding");
    assert.equal(db.tasks.length, 0);
    assert.deepEqual(db.clients[0].tags || [], []);
    assert.notEqual(db.clients[0].custom_fields.employee_next_action, "Pull CRS");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: source has no letter-pack send, no live CRS, no fetch", () => {
  const raw = readFileSync(SRC, "utf8");
  assert.ok(raw.includes("check-product-path"), "canary: C-05 source was actually read");
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /letter-pack/);
  assert.doesNotMatch(code, /letterPack/);
  assert.doesNotMatch(code, /runCrsPull/);
  assert.doesNotMatch(code, /CRS_ALLOW_LIVE/);
  assert.doesNotMatch(code, /stitchcredit/i);
  assert.doesNotMatch(code, /DELIVER_LETTERS/);
});
