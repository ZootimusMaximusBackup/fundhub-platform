import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./u-04-promote-crs-primary.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "u-04-promote-crs-primary.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`U-04 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

/** Extends pgFake with crs_results id lookup used by the verify-crs-row step. */
function dbWithCrs(seed = {}) {
  const db = pgFake(seed);
  const crsResults = seed.crsResults || [];
  const base = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/SELECT id, org_id, client_id FROM crs_results WHERE id/.test(sql)) {
      const row = crsResults.find((r) => r.id === params[0]);
      return {
        rows: row
          ? [{ id: row.id, org_id: row.org_id, client_id: row.client_id }]
          : []
      };
    }
    return base(sql, params);
  };
  return db;
}

test("happy path: CRS result promotes to primary, removes the analyzer-primary tag", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["primary:analyzer"], custom_fields: {} }]
    });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 700 } }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "CRS");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 700);
    assert.equal(db.clients[0].tags.includes("primary:analyzer"), false);
    assert.ok(db.clients[0].tags.includes("primary:crs"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("happy path with anchored crsResultId promotes when row matches org/client", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: [], custom_fields: {} }],
      crsResults: [{ id: "crs-1", org_id: "org-1", client_id: "cl-1" }]
    });
    const res = await handle({
      event: ev("analysis.completed", {
        source: "crs", scores: { ex: 710 }, crsResultId: "crs-1"
      }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "CRS");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 710);
    assert.equal(calls.length, 0);
  });
});

test("branch: analyzer-only source does not promote", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
    const res = await handle({
      event: ev("analysis.completed", { source: "analyzer" }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "not_crs_source");
    assert.equal(db.clients[0].custom_fields?.primary_snapshot_source, undefined);
    assert.equal(calls.length, 0);
  });
});

test("missing CRS row: soft skip, no throw, no promote, no live pull", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        tags: ["primary:analyzer"],
        custom_fields: { primary_snapshot_source: "Analyzer", primary_fico_score: 640 }
      }]
    });
    const res = await handle({
      event: ev("analysis.completed", {
        source: "crs", scores: { ex: 700 }, crsResultId: "crs-missing"
      }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "missing_crs_row");
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "Analyzer");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 640);
    assert.ok(db.clients[0].tags.includes("primary:analyzer"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("wrong org: crs_results row belongs to another org — soft skip, no throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        tags: ["primary:analyzer"],
        custom_fields: { primary_snapshot_source: "Analyzer", primary_fico_score: 650 }
      }],
      crsResults: [{ id: "crs-x", org_id: "org-OTHER", client_id: "cl-1" }]
    });
    const res = await handle({
      event: ev("analysis.completed", {
        source: "crs", scores: { ex: 720 }, crsResultId: "crs-x"
      }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "wrong_org");
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "Analyzer");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 650);
    assert.ok(db.clients[0].tags.includes("primary:analyzer"));
    assert.equal(calls.length, 0);
  });
});

test("wrong org: crs_results row belongs to another client — soft skip", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        custom_fields: { primary_snapshot_source: "Analyzer" }
      }],
      crsResults: [{ id: "crs-y", org_id: "org-1", client_id: "cl-OTHER" }]
    });
    const res = await handle({
      event: ev("analysis.completed", {
        source: "crs", scores: { ex: 720 }, crsResultId: "crs-y"
      }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "wrong_org");
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "Analyzer");
    assert.equal(calls.length, 0);
  });
});

test("already-primary: idempotent re-run, no throw, no live pull", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        tags: ["primary:crs", "primary:analyzer"],
        custom_fields: { primary_snapshot_source: "CRS", primary_fico_score: 700 }
      }],
      crsResults: [{ id: "crs-1", org_id: "org-1", client_id: "cl-1" }]
    });
    const res = await handle({
      event: ev("analysis.completed", {
        source: "crs", scores: { ex: 715 }, crsResultId: "crs-1"
      }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(res.reason, "already_primary");
    assert.equal(db.clients[0].custom_fields.primary_snapshot_source, "CRS");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 715);
    assert.equal(db.clients[0].tags.includes("primary:analyzer"), false);
    assert.ok(db.clients[0].tags.includes("primary:crs"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("already-primary: absent score does not null existing primary FICO", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({
      clients: [{
        id: "cl-1", org_id: "org-1", email: "a@b.com",
        tags: ["primary:crs"],
        custom_fields: { primary_snapshot_source: "CRS", primary_fico_score: 700 }
      }]
    });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: {} }, { clientId: "cl-1" }),
      db, step: fakeStep()
    });
    assert.equal(res.done, true);
    assert.equal(res.reason, "already_primary");
    assert.equal(db.clients[0].custom_fields.primary_fico_score, 700);
    assert.equal(calls.length, 0);
  });
});

test("missing client does not throw, does not pull", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({ clients: [] });
    const res = await handle({
      event: ev("analysis.completed", { source: "crs", scores: { ex: 650 } }),
      db, step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(calls.length, 0);
  });
});

test("null event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = dbWithCrs({ clients: [] });
    const res = await handle({ event: null, db, step: fakeStep() });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_event");
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
