import { test } from "node:test";
import assert from "node:assert";
import { handle, JOSH_CODE, VENDOR_SETTER_TASK } from "./ai-set-01-josh-setter.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const CLIENT_PHONE = "+15555550100";

function stubPlaceCall(sink) {
  return async (args) => {
    sink.push(args);
    return { status: "blocked", blocked: true, reason: "dry_run", callId: null };
  };
}

function withAgents(db, agents) {
  const orig = db.query.bind(db);
  db.query = async (sql, params = []) => {
    if (/FROM agents/.test(sql)) {
      const row = agents.find((a) => a.org_id === params[0] && a.code === params[1]);
      return { rows: row ? [row] : [] };
    }
    return orig(sql, params);
  };
  return db;
}

test("booking.created would call placeCall with Josh prompt + client phone", async () => {
  // Dry-run: no real person called.
  const placed = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, true);
  assert.equal(res.agentSource, "vendor_prompt");
  assert.equal(placed.length, 1);
  assert.equal(placed[0].phone, CLIENT_PHONE);
  assert.equal(placed[0].agent.prompt, VENDOR_SETTER_TASK);
  assert.match(placed[0].agent.prompt, /You are Josh/);
  assert.equal(placed[0].clientId, "cl-1");
});

test("AG-04 row wins over the vendor file when it is ready", async () => {
  // Dry-run: no real person called.
  const placed = [];
  const dbPrompt = "You are Josh. Confirm the Strategy Session from the Agent Editor.";
  const db = withAgents(pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: CLIENT_PHONE }]
  }), [{
    org_id: "org-1",
    code: JOSH_CODE,
    name: "Setter Josh",
    status: "live",
    channel: "voice",
    agent_class: "client_facing",
    runtime: "bland",
    prompt: dbPrompt
  }]);
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, true);
  assert.equal(res.agentSource, "ag-04");
  assert.equal(placed[0].phone, CLIENT_PHONE);
  assert.equal(placed[0].agent.prompt, dbPrompt);
});

test("no phone — placeCall is not invoked", async () => {
  const placed = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }]
  });
  const res = await handle({
    event: ev("booking.created", {}, { clientId: "cl-1" }),
    db,
    step: fakeStep(),
    placeCallImpl: stubPlaceCall(placed)
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_phone");
  assert.equal(placed.length, 0);
});
