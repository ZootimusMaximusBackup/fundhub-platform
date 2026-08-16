import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./c-03-inquiry-removed-resume-or-hold.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "c-03-inquiry-removed-resume-or-hold.mjs");

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`C-03 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

test("happy path: no fraud alert — resumes, tags completed, ready for next round", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: {} }] });
    const res = await handle({ event: ev("inquiry.removed", {}, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "resume");
    assert.equal(db.clients[0].tags.includes("inquiry:pending"), false);
    assert.ok(db.clients[0].tags.includes("inquiry:completed"));
    assert.equal(db.clients[0].custom_fields.ready_for_next_round, true);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("branch: fraud alert holds the file instead", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const res = await handle({ event: ev("inquiry.removed", { fraudAlert: true }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.branch, "fraud_hold");
    assert.equal(db.clients[0].custom_fields.round_hold_reason, "Fraud Alert");
    assert.deepEqual(db.clients[0].tags, ["fraud:alert-present"]);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }] });
    const event = ev("inquiry.removed", {}, { id: "evt-dup-c03", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.branch, "resume");
    assert.equal(first.task.created, true);
    assert.equal(second.done, true);
    assert.equal(second.branch, "resume");
    assert.equal(second.task.created, false);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client → no throw, no task, no SMS, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("inquiry.removed", { inquiryId: "inq-1" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty inquiry payload → resume, no throw, no SMS, no CRS", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", tags: ["inquiry:pending"], custom_fields: {} }] });
    for (const payload of [null, {}, { inquiryId: "" }, { inquiry: null }, { inquiries: [] }]) {
      const res = await handle({
        event: ev("inquiry.removed", payload, { id: `evt-empty-${JSON.stringify(payload)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, true);
      assert.equal(res.branch, "resume");
      assert.equal(res.task.created, true);
    }
    assert.ok(db.clients[0].tags.includes("inquiry:completed"));
    assert.equal(db.clients[0].tags.includes("inquiry:pending"), false);
    assert.equal(db.tasks.length, 5);
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
    assert.equal(db.tasks.length, 0);
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
