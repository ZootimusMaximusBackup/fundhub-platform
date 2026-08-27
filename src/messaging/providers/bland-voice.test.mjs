// bland-voice — the outbound phone seam.
//
// What these tests are really protecting: for a month the Agent Editor showed
// two agents as LIVE "acting on real clients on Voice" while no code in this
// repository could place a call, and the words a real call would have spoken
// lived in a vendor file the screen never touched. Every test below pins one
// half of that: the call comes from the database row, and nothing dials unless
// somebody has explicitly said it may.

import test from "node:test";
import assert from "node:assert/strict";

import {
  placeCall, readiness, normalizePhone, firstSentenceFromPrompt,
  PROVIDER, TRANSMITS, ENABLED, BLAND_API_BASE
} from "./bland-voice.mjs";

/* "0" is required, not decoration. src/lib/outbound-fetch.mjs defaults to
   BLOCKED, so a test that forgot this would transmit nothing and pass for the
   wrong reason — the trap providers.test.mjs:45-49 names. */
const LIVE = { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: "bland-test-key" };

const goodAgent = {
  code: "AG-04", name: "Setter Josh", status: "live",
  channel: "voice", agent_class: "client_facing", runtime: "bland",
  prompt: "You are Josh, an AI setter for Fundhub. Book a call with the client."
};

function response(body = { status: "queued", call_id: "call-abc" }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { forEach() {} }
  };
}

/* ── the fence ──────────────────────────────────────────────────────────── */

test("the messaging fence blocks a call by default, and says so rather than lying", async () => {
  let called = false;
  const r = await placeCall({
    agent: goodAgent, phone: "+15551234567",
    env: { BLAND_API_KEY: "bland-test-key" },   // MESSAGING_DRY_RUN deliberately unset
    fetchImpl: async () => { called = true; return response(); }
  });
  assert.equal(called, false, "an unset fence must not reach the network");
  assert.equal(r.status, "blocked");
  assert.equal(r.blocked, true);
  assert.equal(r.callId, null);
  assert.notEqual(r.status, "sent", "a held call must never report as sent");
});

/* ── the four refusals, none of which may look like a send ──────────────── */

test("an agent that is not live cannot call anyone", async () => {
  let called = false;
  const r = await placeCall({
    agent: { ...goodAgent, status: "draft" }, phone: "+15551234567",
    env: LIVE, fetchImpl: async () => { called = true; return response(); }
  });
  assert.equal(called, false);
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "not_live");
});

test("a live agent with no prompt cannot call anyone — the exact shape 037 seeded", async () => {
  let called = false;
  for (const prompt of [null, "", "   "]) {
    const r = await placeCall({
      agent: { ...goodAgent, prompt }, phone: "+15551234567",
      env: LIVE, fetchImpl: async () => { called = true; return response(); }
    });
    assert.equal(r.status, "rejected", `prompt=${JSON.stringify(prompt)}`);
    assert.equal(r.reason, "no_prompt");
  }
  assert.equal(called, false, "an empty prompt must never reach Bland");
});

test("an agent that does not run on the phone system cannot place a call", async () => {
  const r = await placeCall({
    agent: { ...goodAgent, runtime: "internal" }, phone: "+15551234567",
    env: LIVE, fetchImpl: async () => response()
  });
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "not_a_voice_runtime");
});

test("no API key is reported as not configured, never as a send", async () => {
  const r = await placeCall({
    agent: goodAgent, phone: "+15551234567",
    env: { MESSAGING_DRY_RUN: "0" }, fetchImpl: async () => response()
  });
  assert.equal(r.status, "rejected");
  assert.equal(r.reason, "not_configured");
});

test("an unusable phone number is refused before anything is dialled", async () => {
  let called = false;
  for (const phone of [null, "", "123", "not a phone"]) {
    const r = await placeCall({
      agent: goodAgent, phone,
      env: LIVE, fetchImpl: async () => { called = true; return response(); }
    });
    assert.equal(r.reason, "no_phone", `phone=${JSON.stringify(phone)}`);
    assert.equal(r.status, "rejected");
  }
  assert.equal(called, false);
});

/* ── the whole point: the words come from the database row ──────────────── */

test("the task Bland speaks is the agent's stored prompt, not a vendor file", async () => {
  let sent = null;
  const r = await placeCall({
    agent: goodAgent, phone: "(555) 123-4567", clientId: "client-1",
    env: LIVE,
    fetchImpl: async (url, init) => { sent = { url, init }; return response(); }
  });

  assert.equal(r.status, "sent");
  assert.equal(r.callId, "call-abc");
  assert.equal(String(sent.url), `${BLAND_API_BASE}/calls`);

  const body = JSON.parse(sent.init.body);
  assert.equal(body.task, goodAgent.prompt,
    "the call must speak agents.prompt — that is what makes the Agent Editor the source of truth");
  assert.equal(body.first_sentence, firstSentenceFromPrompt(goodAgent.prompt),
    "Bland must have opening words — missing first_sentence ended prove calls in 0.13s");
  assert.equal(body.wait_for_greeting, true, "a real client line still waits for a hello");
  assert.equal(body.phone_number, "+15551234567", "the number is normalised to E.164");
  assert.equal(body.metadata.agent_code, "AG-04");
  assert.equal(body.metadata.client_id, "client-1");
  assert.ok(body.webhook, "a call with no return webhook can never be filed against anybody");
});

/* ── pickup and the tape ────────────────────────────────────────────────── */

test("the call asks for a nearby number and for a recording", async () => {
  let sent = null;
  await placeCall({
    agent: goodAgent, phone: "+16616054248", env: LIVE,
    fetchImpl: async (url, init) => { sent = { url, init }; return response(); }
  });
  const body = JSON.parse(sent.init.body);
  assert.equal(body.local_dialing, true,
    "without this Bland dials from a fresh out-of-area number every time and the handset stops answering");
  assert.equal(body.record, true,
    "Bland defaults record to false, so every tape was empty no matter how the call went");
});

test("the agent prove line does not wait for a greeting", async () => {
  let sent = null;
  await placeCall({
    agent: goodAgent, phone: "+16616054248", env: LIVE,
    fetchImpl: async (url, init) => { sent = { url, init }; return response(); }
  });
  const body = JSON.parse(sent.init.body);
  assert.equal(body.wait_for_greeting, false);
  assert.ok(body.first_sentence);
});

test("firstSentenceFromPrompt takes the first spoken line", () => {
  assert.equal(
    firstSentenceFromPrompt("You are Josh, an AI setter for Fundhub. Book a call with the client."),
    "You are Josh, an AI setter for Fundhub."
  );
  assert.equal(firstSentenceFromPrompt(""), "Hey — can you hear me?");
});

test("Bland's key goes in Authorization with no Bearer prefix", async () => {
  // vendor/inquiry-remover/src/lib/bland-client.js:25-30 — sending Bearer 401s.
  let headers = null;
  await placeCall({
    agent: goodAgent, phone: "+15551234567", env: LIVE,
    fetchImpl: async (url, init) => { headers = init.headers; return response(); }
  });
  const auth = headers.Authorization || headers.authorization;
  assert.equal(auth, "bland-test-key");
  assert.ok(!/^Bearer/i.test(auth));
});

/* ── failures stay failures ─────────────────────────────────────────────── */

test("a call Bland accepts but does not give an id for is not reported as sent", async () => {
  const r = await placeCall({
    agent: goodAgent, phone: "+15551234567", env: LIVE,
    fetchImpl: async () => response({ status: "queued" })   // no call_id
  });
  assert.notEqual(r.status, "sent");
  assert.equal(r.reason, "no_call_id");
  assert.match(r.error, /cannot be matched back/i);
});

test("a rejection from Bland is a rejection here", async () => {
  const r = await placeCall({
    agent: goodAgent, phone: "+15551234567", env: LIVE,
    fetchImpl: async () => response({ errors: ["bad number"] }, 400)
  });
  assert.equal(r.status, "rejected");
  assert.equal(r.callId, null);
});

test("a transport failure never throws and never reports a send", async () => {
  const r = await placeCall({
    agent: goodAgent, phone: "+15551234567", env: LIVE,
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  assert.notEqual(r.status, "sent");
  assert.equal(r.callId, null);
});

/* ── shape ──────────────────────────────────────────────────────────────── */

test("normalizePhone accepts what can be dialled and refuses what cannot", () => {
  assert.equal(normalizePhone("5551234567"), "+15551234567");
  assert.equal(normalizePhone("15551234567"), "+15551234567");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("(555) 123-4567"), "+15551234567");
  for (const bad of ["", null, undefined, "123", "abc"]) {
    assert.equal(normalizePhone(bad), null, JSON.stringify(bad));
  }
});

test("readiness explains a refusal in words a non-engineer can act on", () => {
  for (const [agent, reason] of [
    [null, "no_agent"],
    [{ ...goodAgent, runtime: "ghl" }, "not_a_voice_runtime"],
    [{ ...goodAgent, status: "retired" }, "not_live"],
    [{ ...goodAgent, prompt: "" }, "no_prompt"]
  ]) {
    const r = readiness(agent, LIVE);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.ok(r.message.length > 20, `${reason} needs a real sentence`);
    assert.ok(!/undefined|null|\bERR\b/.test(r.message));
  }
  assert.equal(readiness(goodAgent, LIVE).ok, true);
});

test("the module declares its posture, and is not routable as a message sender", () => {
  assert.equal(PROVIDER, "bland_voice");
  assert.equal(TRANSMITS, true, "it reaches a person; the fence test reads this");
  assert.equal(ENABLED, false, "it must never become a channel's default sender");
});
