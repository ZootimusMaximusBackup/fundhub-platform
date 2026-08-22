import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyTwilioSignature,
  normalizeTwilioEvent,
  mapToCanonical,
  handleTwilioWebhook
} from "./twilio.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

// Fake db — mirrors commas.test.mjs exactly.
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

const AUTH_TOKEN = "test_auth_token_secret";
const TEST_URL = "https://fundhub.ai/api/webhooks/twilio";

// Build a VALID Twilio signature for a given url + params object.
function sign(url, params) {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.reduce((acc, k) => acc + k + (params[k] ?? ""), "");
  return crypto.createHmac("sha1", AUTH_TOKEN).update(url + paramStr, "utf8").digest("base64");
}

// Build a urlencoded body string from a params object.
function toBody(params) {
  return new URLSearchParams(params).toString();
}

const SAMPLE_PARAMS = {
  MessageSid: "SM_abc123",
  From: "+15005550006",
  To: "+15005550001",
  Body: "Hello from Twilio",
  NumMedia: "0",
  AccountSid: "AC_test"
};

// --- signature ---------------------------------------------------------------
test("verifyTwilioSignature: accepts valid signature", () => {
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  assert.equal(verifyTwilioSignature(TEST_URL, SAMPLE_PARAMS, sig, AUTH_TOKEN), true);
});

test("verifyTwilioSignature: rejects tampered body params", () => {
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  const tampered = { ...SAMPLE_PARAMS, Body: "evil payload" };
  assert.equal(verifyTwilioSignature(TEST_URL, tampered, sig, AUTH_TOKEN), false);
});

test("verifyTwilioSignature: rejects missing signature", () => {
  assert.equal(verifyTwilioSignature(TEST_URL, SAMPLE_PARAMS, "", AUTH_TOKEN), false);
  assert.equal(verifyTwilioSignature(TEST_URL, SAMPLE_PARAMS, null, AUTH_TOKEN), false);
});

test("verifyTwilioSignature: rejects missing auth token (fail-closed)", () => {
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  assert.equal(verifyTwilioSignature(TEST_URL, SAMPLE_PARAMS, sig, null), false);
  assert.equal(verifyTwilioSignature(TEST_URL, SAMPLE_PARAMS, sig, ""), false);
});

// --- normalize ---------------------------------------------------------------
test("normalizeTwilioEvent: parses urlencoded body correctly", () => {
  const raw = toBody(SAMPLE_PARAMS);
  const evt = normalizeTwilioEvent(raw);
  assert.equal(evt.sid, "SM_abc123");
  assert.equal(evt.from, "+15005550006");
  assert.equal(evt.to, "+15005550001");
  assert.equal(evt.body, "Hello from Twilio");
  assert.equal(evt.numMedia, 0);
  assert.equal(evt.accountSid, "AC_test");
});

test("normalizeTwilioEvent: empty body produces nulls, no throw", () => {
  const evt = normalizeTwilioEvent("");
  assert.equal(evt.sid, null);
  assert.equal(evt.from, null);
  assert.equal(evt.body, "");
});

test("normalizeTwilioEvent: empty Body string is preserved (not null)", () => {
  const raw = toBody({ ...SAMPLE_PARAMS, Body: "" });
  const evt = normalizeTwilioEvent(raw);
  assert.equal(evt.body, "");
  assert.equal(evt.sid, "SM_abc123"); // still a message webhook
});

// --- mapToCanonical ----------------------------------------------------------
test("mapToCanonical: inbound message => message.inbound", () => {
  const canonical = mapToCanonical({ sid: "SM_abc123" });
  assert.deepEqual(canonical.map((c) => c.name), ["message.inbound"]);
});

test("mapToCanonical: no MessageSid => empty (not a message webhook)", () => {
  assert.deepEqual(mapToCanonical({ sid: null }), []);
  assert.deepEqual(mapToCanonical(null), []);
});

// --- message.inbound payload -------------------------------------------------
test("message.inbound payload has correct shape", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = fakeDb({ store });

  const raw = toBody(SAMPLE_PARAMS);
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  await handleTwilioWebhook({ db, rawBody: raw, signatureHeader: sig, secret: AUTH_TOKEN, url: TEST_URL });

  assert.equal(store.length, 1);
  const { payload } = store[0];
  assert.equal(payload.from, "+15005550006");
  assert.equal(payload.to, "+15005550001");
  assert.equal(payload.body, "Hello from Twilio");
  assert.equal(payload.sid, "SM_abc123");
  assert.equal(payload.channel, "sms");
  assert.equal(payload.source, "twilio");
  assert.deepEqual(payload.mediaUrls, []);
});

// --- not-a-message path ------------------------------------------------------
test("handleTwilioWebhook: no MessageSid => 200, reason=not_a_message, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const params = { CallSid: "CA_xyz", CallStatus: "completed" };
  const raw = toBody(params);
  const sig = sign(TEST_URL, params);
  const res = await handleTwilioWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sig, secret: AUTH_TOKEN, url: TEST_URL });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.reason, "not_a_message");
  assert.deepEqual(res.emitted, []);
});

// --- idempotency -------------------------------------------------------------
test("handleTwilioWebhook: re-delivered webhook is idempotent (deduped)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("message.inbound", () => (fired += 1));

  const raw = toBody(SAMPLE_PARAMS);
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  const db = fakeDb({ dedup: true }); // simulate row already exists
  const res = await handleTwilioWebhook({ db, rawBody: raw, signatureHeader: sig, secret: AUTH_TOKEN, url: TEST_URL });

  assert.ok(res.emitted.every((e) => e.deduped === true), "all events should be deduped");
  assert.equal(fired, 0, "handler must not fire on a deduped event");
});

// --- full dispatch (bad sig) -------------------------------------------------
test("handleTwilioWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = toBody(SAMPLE_PARAMS);
  const res = await handleTwilioWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "bad", secret: AUTH_TOKEN, url: TEST_URL });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.deepEqual(res.emitted, []);
});

// --- full dispatch (valid, handler fires) ------------------------------------
test("handleTwilioWebhook: valid inbound SMS emits + dispatches handler", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("message.inbound", (e) => seen.push(e.name));

  const raw = toBody(SAMPLE_PARAMS);
  const sig = sign(TEST_URL, SAMPLE_PARAMS);
  const res = await handleTwilioWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sig, secret: AUTH_TOKEN, url: TEST_URL });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["message.inbound"]);
  assert.deepEqual(seen, ["message.inbound"]);
});
