import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handle } from "./dpc-03-inbound-reply-router.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "dpc-03-inbound-reply-router.mjs");

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "closed_won", pipeline_id: "pl-sales", stage_id: "st-closed" },
    { pipeline_key: "sales", stage_key: "downsell", pipeline_id: "pl-sales", stage_id: "st-downsell" }
  ]
});

async function withFetchTrap(fn) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    calls.push({ url: String(args[0]), via: "global.fetch" });
    throw new Error(`DPC-03 must not fetch (${String(args[0])})`);
  };
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = prev;
  }
}

// NOT gated on dpc03_awaiting_decision — that field is the dead flag the fix removed
// (nothing in the repo ever writes it). Setting it here would make this test pass
// identically on the pre-fix `isDpc03Context` gate too, masking the regression it's
// meant to prove is gone. Leaving custom_fields empty means this only passes because
// the call-state disambiguation (doc 3576-3578) lets a plain YES through on its own.
test("happy path: YES reply creates the contract task and moves to closed", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "YES let's do it" }), db, step: fakeStep() });
  assert.equal(res.decision, "yes");
  assert.equal(res.task.created, true);
  assert.equal(db.cards[0].stage_id, "st-closed");
});

test("branch: RESCHEDULE reply creates the booking-link task + sends the reschedule SMS, no card move", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: "SMS-DPC04-RESCHEDULE-REBOOKING", channel: "sms", body: "reschedule", compliance_passed: true }],
    ...withStages()
  });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "can we reschedule" }), db, step: fakeStep() });
  assert.equal(res.decision, "reschedule");
  assert.equal(res.sms.sent, true);
  assert.deepEqual(db.clients[0].tags, ["setter:reschedule"]);
  assert.equal(db.cards.length, 0);
});

test("branch: CLOSE reply moves to downsell + clears nurture tags", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", tags: ["nurture:warm"], custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "please close my file" }), db, step: fakeStep() });
  assert.equal(res.decision, "close_file");
  assert.equal(db.clients[0].tags.includes("nurture:warm"), false);
  assert.equal(db.cards[0].stage_id, "st-downsell");
});

test("branch: no decision keyword — ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567" }] });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "what time is my call" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("branch: unknown phone number does not mint a client", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("message.inbound", { from: "+19998887777", body: "YES" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.clients.length, 0);
});

test("branch: STOP SMS is ignored (telco opt-out, not a DPC-03 keyword)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "STOP" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_decision_keyword");
});

// REGRESSION: the YES purchase branch was gated on `dpc03_awaiting_decision`, a field
// NOTHING in the repo ever writes — so it was permanently unreachable. 05/30 doc
// 3576-3578 disambiguates by call state instead.
test("REGRESSION: YES after the call reaches the purchase branch (no dead context flag)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "showed" } }] });
  const res = await handle({ event: ev("message.inbound", { body: "YES", from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.decision, "yes");
  assert.equal(res.task.created, true);
});

test("YES while the call is still booked is a CALL CONFIRMATION, not a sale", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "booked" } }] });
  const res = await handle({ event: ev("message.inbound", { body: "yes", from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.decision, "call_confirmed");
  assert.equal(db.clients[0].custom_fields.call_confirmed, true);
  assert.equal(db.clients[0].custom_fields.decision_status, undefined, "must not close a sale off a confirmation");
  assert.equal(db.tasks.length, 0);
});

test("REGRESSION: a hard-stopped contact cannot trigger the contract+payment task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "showed", hard_stop_reason: "fraud_flag" } }] });
  const res = await handle({ event: ev("message.inbound", { body: "YES", from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "hard_stopped");
  assert.equal(db.tasks.length, 0);
});

// REGRESSION: the invented bare-"no" keyword closed files off ordinary replies.
test("REGRESSION: 'no thanks' no longer closes the file", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: {} }] });
  for (const body of ["no thanks", "no worries", "not today"]) {
    const res = await handle({ event: ev("message.inbound", { body, from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.reason, "no_decision_keyword", `"${body}" must not be a decision`);
  }
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: { dpc03_awaiting_decision: true } }], ...withStages() });
    const event = ev("message.inbound", { from: "+15551234567", body: "YES" }, { id: "evt-dup-dpc03" });
    await handle({ event, db, step: fakeStep() });
    await handle({ event, db, step: fakeStep() });
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: missing client does not throw, no CRS, no outbox drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    const res = await handle({
      event: ev("message.inbound", { from: "+19998887777", body: "YES" }, { id: "evt-miss-dpc03" }),
      db,
      step: fakeStep()
    });
    assert.equal(res.done, false);
    assert.equal(res.reason, "no_client");
    assert.equal(db.clients.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(db.events.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: empty body does not throw, no decision, no CRS, no SMS queue", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
      templates: [{ org_id: "org-1", template_key: "SMS-DPC04-RESCHEDULE-REBOOKING", channel: "sms", body: "reschedule", compliance_passed: true }],
      ...withStages()
    });
    for (const body of ["", "   ", null, undefined]) {
      const res = await handle({
        event: ev("message.inbound", { from: "+15551234567", body }, { id: `evt-empty-body-${String(body)}`, clientId: "cl-1" }),
        db,
        step: fakeStep()
      });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_decision_keyword");
    }
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.cards.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: null / non-object event does not throw", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({ clients: [] });
    for (const bad of [null, undefined, "message.inbound", 42]) {
      const res = await handle({ event: bad, db, step: fakeStep() });
      assert.equal(res.done, false);
      assert.equal(res.reason, "no_event");
    }
    assert.equal(db.messages.length, 0);
    assert.equal(db.tasks.length, 0);
    assert.equal(calls.length, 0);
  });
});

test("smash: duplicate RESCHEDULE keeps one task + one queued SMS, no fetch, no drain", async () => {
  await withFetchTrap(async ({ calls }) => {
    const db = pgFake({
      clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
      templates: [{ org_id: "org-1", template_key: "SMS-DPC04-RESCHEDULE-REBOOKING", channel: "sms", body: "reschedule", compliance_passed: true }],
      ...withStages()
    });
    const event = ev("message.inbound", { from: "+15551234567", body: "please reschedule" }, { id: "evt-dup-resched-dpc03", clientId: "cl-1" });
    const first = await handle({ event, db, step: fakeStep() });
    const second = await handle({ event, db, step: fakeStep() });
    assert.equal(first.done, true);
    assert.equal(first.task.created, true);
    assert.equal(second.done, true);
    assert.equal(second.task.created, false);
    assert.equal(db.tasks.length, 1);
    assert.equal(db.messages.length, 1);
    assert.deepEqual(db.clients[0].tags, ["setter:reschedule"]);
    assert.equal(calls.length, 0);
  });
});

test("source must not pull CRS, drain outbox, or flip CRS_ALLOW_LIVE", () => {
  const code = readFileSync(SRC, "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(/);
  assert.doesNotMatch(code, /\bfetchImpl\b/);
  assert.doesNotMatch(code, /\brunCrsPull\b/);
  assert.doesNotMatch(code, /\brequestSoftPull\b/);
  assert.doesNotMatch(code, /\bcrs-pull\b/);
  assert.doesNotMatch(code, /\bCRS_ALLOW_LIVE\b/);
  assert.doesNotMatch(code, /\bsoft_pull\b/);
  assert.doesNotMatch(code, /\bdrain(All)?\s*\(/);
  assert.doesNotMatch(code, /\bdispatchDue\b/);
  assert.doesNotMatch(code, /outbox\.mjs/);
  assert.doesNotMatch(code, /vercel\.app/);
  assert.doesNotMatch(code, /bland/i);
  assert.doesNotMatch(code, /gohighlevel|ghl\.com/i);
});
