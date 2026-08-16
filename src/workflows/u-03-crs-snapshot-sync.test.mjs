import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./u-03-crs-snapshot-sync.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "u-03-crs-snapshot-sync.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`U-03 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: CRS-sourced analysis.completed syncs the snapshot fields", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 640 }, occurredAt: "2026-08-14T12:00:00.000Z" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
    assert.equal(db.clients[0].custom_fields.crs_fico_score, 640);
    assert.equal(db.clients[0].custom_fields.crs_snapshot_date, "2026-08-14T12:00:00.000Z");
    assert.deepEqual(db.clients[0].tags, ["crs:snapshot"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: non-CRS source (e.g. analyzer estimate) is ignored", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "not_crs_source");
    assert.equal(db.clients[0].custom_fields?.crs_status, undefined);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing CRS scores: no Complete stamp, hold tag, no throw, no pull, no email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: { crs_status: "Requested" } }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(res.branch, "missing_results");
    assert.equal(db.clients[0].custom_fields.crs_status, "Requested");
    assert.ok(!(db.clients[0].tags || []).includes("crs:snapshot"));
    assert.deepEqual(db.clients[0].tags, ["hold:snapshot_missing"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing CRS scores with null/empty score bag: same hold, no Complete", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    for (const scores of [null, {}, { ex: null, eq: null, tu: null }]) {
      const res = await handle({
        event: ev("analysis.completed", { source: "crs", scores }, { clientId: "cl-1" }),
        db, step: fakeStep()
      });
      assert.equal(res.branch, "missing_results");
      assert.equal(db.clients[0].custom_fields.crs_status, undefined);
      assert.ok(!(db.clients[0].tags || []).includes("crs:snapshot"));
      assert.ok((db.clients[0].tags || []).includes("hold:snapshot_missing"));
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw, does not pull, does not email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("null event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({ event: null, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replay does not double-tag, does not pull, does not email", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {}, tags: [] }]
    });
    const event = ev(
      "analysis.completed",
      { source: "crs", scores: { ex: 640 }, occurredAt: "2026-08-14T12:00:00.000Z" },
      { id: "evt-dup-u03", clientId: "cl-1" }
    );
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(second.done, true);
    assert.deepEqual(db.clients[0].tags, ["crs:snapshot"]);
    assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
    assert.equal(db.clients[0].custom_fields.crs_fico_score, 640);
    assert.equal(db.clients[0].custom_fields.crs_snapshot_date, "2026-08-14T12:00:00.000Z");
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("real scores clear a prior hold:snapshot_missing tag", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        custom_fields: { crs_status: "Requested" },
        tags: ["hold:snapshot_missing"]
      }]
    });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { eq: 700 } }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.crs_status, "Complete");
    assert.deepEqual(db.clients[0].tags, ["crs:snapshot"]);
    assert.equal(db.messages.length, 0);
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
