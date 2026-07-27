import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyBlandSignature,
  normalizeBlandEvent,
  mapToCanonical,
  handleBlandWebhook
} from "./bland.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db mirroring commas.test.mjs conventions.
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "bland_whsec_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

// --- signature ---------------------------------------------------------------

test("verifyBlandSignature: accepts valid hex, accepts sha256= prefix, rejects tampered / empty / no-secret", () => {
  const raw = JSON.stringify({ call_id: "abc" });
  assert.equal(verifyBlandSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyBlandSignature(raw, "sha256=" + sign(raw), SECRET), true);
  assert.equal(verifyBlandSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyBlandSignature(raw, "", SECRET), false);
  assert.equal(verifyBlandSignature(raw, sign(raw), null), false); // no secret → closed
});

// --- normalize ---------------------------------------------------------------

test("normalizeBlandEvent: reads a representative completed-call payload", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_999",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 187.4,
    transferred_to: "+18554146048"
  });
  assert.equal(evt.callId, "call_999");
  assert.equal(evt.status, "completed");
  assert.equal(evt.isCompleted, true);
  assert.equal(evt.disposition, "human");
  assert.equal(evt.durationSec, 187); // rounded
  assert.equal(evt.transferred, true);
});

test("normalizeBlandEvent: in-progress call → isCompleted false", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_200",
    status: "in-progress",
    completed: false
  });
  assert.equal(evt.isCompleted, false);
  assert.equal(evt.transferred, false);
});

test("normalizeBlandEvent: completed flag alone (no status) → isCompleted true", () => {
  const evt = normalizeBlandEvent({ call_id: "call_300", completed: true, call_length: 60 });
  assert.equal(evt.isCompleted, true);
  assert.equal(evt.durationSec, 60);
});

test("normalizeBlandEvent: answered_by falls back to disposition, duration field wins over call_length", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_400",
    status: "ended",
    answered_by: "voicemail",
    duration: 45,
    call_length: 999 // should be ignored when duration is present
  });
  assert.equal(evt.disposition, "voicemail");
  assert.equal(evt.durationSec, 45);
});

// --- canonical mapping -------------------------------------------------------

test("mapToCanonical: completed call → [{name:'call.completed', payload}]", () => {
  const evt = normalizeBlandEvent({
    call_id: "call_500",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 120,
    transferred_to: null
  });
  const canonical = mapToCanonical(evt);
  assert.equal(canonical.length, 1);
  const c = canonical[0];
  assert.equal(c.name, "call.completed");
  assert.equal(c.payload.callId, "call_500");
  assert.equal(c.payload.status, "completed");
  assert.equal(c.payload.disposition, "human");
  assert.equal(c.payload.outcome, "transferred"); // human → transferred
  assert.equal(c.payload.durationSec, 120);
  assert.equal(c.payload.transferred, false);
  assert.equal(c.payload.source, "bland");
});

test("mapToCanonical: outcome mapping — declined/no_answer/voicemail", () => {
  const mkEvt = (disposition) => normalizeBlandEvent({ call_id: "x", status: "completed", completed: true, disposition });
  assert.equal(mapToCanonical(mkEvt("declined"))[0].payload.outcome, "declined");
  assert.equal(mapToCanonical(mkEvt("no_answer"))[0].payload.outcome, "no_answer");
  assert.equal(mapToCanonical(mkEvt("voicemail"))[0].payload.outcome, "no_answer");
});

test("mapToCanonical: in-progress → empty array", () => {
  const evt = normalizeBlandEvent({ call_id: "x", status: "in-progress", completed: false });
  assert.deepEqual(mapToCanonical(evt), []);
});

// --- full adapter ------------------------------------------------------------

test("handleBlandWebhook: bad signature → 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ call_id: "c1", status: "completed", completed: true });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleBlandWebhook: completed call → call.completed emitted, handler fires", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("call.completed", (e) => seen.push(e.name));

  const raw = JSON.stringify({
    call_id: "call_601",
    status: "completed",
    completed: true,
    disposition: "human",
    call_length: 200,
    transferred_to: "+18554146048"
  });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["call.completed"]);
  assert.deepEqual(seen, ["call.completed"]);
});

test("handleBlandWebhook: not_completed (in-progress) → 200, emitted=[], reason=not_completed", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ call_id: "call_700", status: "in-progress", completed: false });
  const res = await handleBlandWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "not_completed");
  assert.deepEqual(res.emitted, []);
});

test("handleBlandWebhook: clientId passed through to bus emit", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  // Intercept the INSERT INTO events call to capture client_id param
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ clientId: params[4], name: params[1] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({ call_id: "call_900", status: "completed", completed: true, disposition: "declined" });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET, clientId: "cl-42" });
  assert.equal(res.ok, true);
  assert.equal(store[0]?.clientId, "cl-42");
});

test("handleBlandWebhook: resolves clientId from outbound_calls when none provided", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/SELECT client_id FROM outbound_calls/.test(sql)) {
        // Simulate a prior recordDispatch for this callId
        if (params[0] === "call_lookup_test") return { rows: [{ client_id: "client-resolved-99" }] };
        return { rows: [] };
      }
      if (/INSERT INTO events/.test(sql)) {
        store.push({ clientId: params[4], name: params[1] });
        return { rows: [{ id: "evt-1" }] };
      }
      return { rows: [] };
    }
  };
  const raw = JSON.stringify({ call_id: "call_lookup_test", status: "completed", completed: true, disposition: "human" });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  // No clientId passed in — must be resolved from outbound_calls
  assert.equal(res.ok, true);
  assert.equal(store[0]?.clientId, "client-resolved-99");
});

test("handleBlandWebhook: idempotent re-delivery → deduped=true, handler does not fire", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("call.completed", () => (fired += 1));

  const raw = JSON.stringify({ call_id: "call_800", status: "completed", completed: true });
  const db = fakeDb({ dedup: true });
  const res = await handleBlandWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on deduped replay");
});
