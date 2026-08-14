import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./dpc-01-analyzer-lock.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "dpc-01-analyzer-lock.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`DPC-01 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: writes progress markers, does NOT write analyzer_path (c-00 owns it)", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    // analysis.completed carries no analyzerPath — workflow must not gate on it
    const res = await handle({ event: ev("analysis.completed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.analyzer_path, undefined); // c-00 owns this
    assert.equal(db.clients[0].custom_fields.last_progress_action, "analyzer_completed");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw, does not pull, does not email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { occurredAt: "2026-01-01T00:00:00.000Z" }),
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

test("null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const event of [null, undefined, "junk", 42]) {
      const res = await handle({ event, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("empty payload: null / {} — lock progress, no throw, no pull, no email", async () => {
  await withFetchTrap(async ({ calls }) => {
    for (const payload of [null, {}]) {
      const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
      const res = await handle({
        event: ev("analysis.completed", payload, { clientId: "cl-1" }),
        db, step: fakeStep()
      });
      assert.equal(res.done, true);
      assert.equal(db.clients[0].custom_fields.last_progress_action, "analyzer_completed");
      assert.ok(typeof db.clients[0].custom_fields.last_progress_timestamp === "string");
      assert.equal(db.clients[0].custom_fields.analyzer_path, undefined);
      assert.equal(db.messages.length, 0);
    }
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying re-merges same markers, does not email or pull", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev(
      "analysis.completed",
      { occurredAt: "2026-01-01T00:00:00.000Z" },
      { id: "evt-dup-dpc01", clientId: "cl-1" }
    );
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.equal(db.clients[0].custom_fields.last_progress_action, "analyzer_completed");
    assert.equal(db.clients[0].custom_fields.last_progress_timestamp, "2026-01-01T00:00:00.000Z");
    assert.equal(db.clients[0].custom_fields.analyzer_path, undefined);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(db.tasks.length, 0);
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
  assert.doesNotMatch(code, /\bletter-pack\b/);
  assert.doesNotMatch(code, /\bu-02-analyzer-complete-delivery\b/);
});
