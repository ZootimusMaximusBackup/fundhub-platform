import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./f-05-inquiry-cleanup-gate.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "f-05-inquiry-cleanup-gate.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`F-05 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: open inquiries flip to Pending Removal", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      inquiryLog: [
        { client_id: "cl-1", status: "Active" },
        { client_id: "cl-1", status: "Active" }
      ]
    });
    const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.done, true);
    assert.equal(res.updated, 2);
    assert.ok(db.inquiryLog.every((r) => r.status === "Pending Removal"));
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: already-Removed inquiries are left alone", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      inquiryLog: [{ client_id: "cl-1", status: "Removed" }]
    });
    const res = await handle({ event: ev("round.approved", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.updated, 0);
    assert.equal(db.inquiryLog[0].status, "Removed");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying is a no-op the second time (already Pending Removal)", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      inquiryLog: [{ client_id: "cl-1", status: "Active" }]
    });
    const event = ev("round.approved", {}, { id: "evt-dup-f05", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.updated, 1);
    assert.equal(second.done, true);
    assert.equal(second.updated, 0);
    assert.equal(db.inquiryLog[0].status, "Pending Removal");
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client → no throw, no SMS, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [], inquiryLog: [{ client_id: "cl-missing", status: "Active" }] });
    const res = await handle({
      event: ev("round.approved", { inquiryId: "inq-1" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.inquiryLog[0].status, "Active");
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty inquiry payload → done, updated 0, no throw, no SMS, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
      inquiryLog: []
    });
    for (const payload of [null, {}, { inquiryId: "" }, { inquiry: null }, { inquiries: [] }]) {
      const res = await handle({
        event: ev("round.approved", payload, { id: `evt-empty-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, true);
      assert.equal(res.updated, 0);
    }
    assert.equal(db.inquiryLog.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event → no_event, no throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const event of [null, undefined, "nope", 7]) {
      const res = await handle({ event, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, send mail/SMS, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\bsendTemplated\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bproviders\//);
  assert.doesNotMatch(code, /\bbland\b/i);
  assert.doesNotMatch(code, /\bmailgun\b/i);
  assert.doesNotMatch(code, /\bresend\b/i);
  assert.doesNotMatch(code, /vercel\.app/);
});
