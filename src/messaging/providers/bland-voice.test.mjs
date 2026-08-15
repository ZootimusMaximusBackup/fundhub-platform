import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  placeCall,
  requireVoicemailMessage,
  DEFAULT_VOICEMAIL_MESSAGE,
  PROVIDER,
  TRANSMITS,
  ENABLED
} from "./bland-voice.mjs";
import { resolve } from "./index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: "org_test_key_not_real" };

function fakeFetch(body, status = 200) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { forEach() {} },
      text: async () => JSON.stringify(body)
    };
  };
  impl.calls = calls;
  return impl;
}

describe("bland-voice", () => {
  test("is not on the message dispatcher registry", () => {
    assert.equal(resolve("bland_voice"), null);
    assert.equal(PROVIDER, "bland_voice");
    assert.equal(TRANSMITS, true);
    assert.equal(ENABLED, false);
  });

  test("refuses a POST with no voicemail_message", async () => {
    const fetchImpl = fakeFetch({ call_id: "should-not-send" });
    const out = await placeCall({
      phone: "+16616180865",
      task: "Say hello.",
      voicemailMessage: "   ",
      fetchImpl,
      env: LIVE
    });
    assert.equal(out.status, "rejected");
    assert.match(out.error, /voicemail_message is required/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("refuses voicemail that claims a score or approval", async () => {
    const bad = requireVoicemailMessage("You were pre-approved for funding");
    assert.equal(bad.ok, false);
    const fetchImpl = fakeFetch({ call_id: "nope" });
    const out = await placeCall({
      phone: "+16616180865",
      task: "Say hello.",
      voicemailMessage: "Your FICO is great",
      fetchImpl,
      env: LIVE
    });
    assert.equal(out.status, "rejected");
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("default voicemail is safe and non-empty", () => {
    const ok = requireVoicemailMessage(DEFAULT_VOICEMAIL_MESSAGE);
    assert.equal(ok.ok, true);
    assert.match(ok.text, /Fundhub/);
  });

  test("messaging fence holds when dry-run is not off", async () => {
    const fetchImpl = fakeFetch({ call_id: "nope" });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const out = await placeCall({
        phone: "+16616180865",
        task: "Say hello.",
        voicemailMessage: DEFAULT_VOICEMAIL_MESSAGE,
        fetchImpl,
        env: { BLAND_API_KEY: "org_test_key_not_real" }
      });
      assert.equal(out.blocked, true);
      assert.equal(fetchImpl.calls.length, 0);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("POST always includes amd and voicemail_message", async () => {
    const fetchImpl = fakeFetch({ call_id: "call_vm_1", status: "success" });
    const out = await placeCall({
      phone: "+16616180865",
      task: "Greet Chris then hang up.",
      firstSentence: "Hey Chris.",
      voicemailMessage: DEFAULT_VOICEMAIL_MESSAGE,
      fetchImpl,
      env: LIVE
    });
    assert.equal(out.status, "sent");
    assert.equal(out.providerMessageId, "call_vm_1");
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(fetchImpl.calls[0].url, "https://api.bland.ai/v1/calls");
    const body = JSON.parse(fetchImpl.calls[0].init.body);
    assert.equal(body.amd, true);
    assert.equal(body.voicemail_message, DEFAULT_VOICEMAIL_MESSAGE);
    assert.equal(body.phone_number, "+16616180865");
    assert.equal(body.wait_for_greeting, true);
    assert.ok(!/ghl/i.test(JSON.stringify(body)));
  });

  test("records outbound_calls so the webhook can find the client", async () => {
    const inserts = [];
    const db = {
      async query(sql, params) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
    };
    const fetchImpl = fakeFetch({ call_id: "call_led_1" });
    const out = await placeCall({
      phone: "+16616180865",
      task: "Greet then hang up.",
      voicemailMessage: DEFAULT_VOICEMAIL_MESSAGE,
      clientId: "client-a",
      orgId: "org-1",
      db,
      fetchImpl,
      env: LIVE
    });
    assert.equal(out.status, "sent");
    assert.equal(inserts.length, 1);
    assert.match(inserts[0].sql, /INSERT INTO outbound_calls/);
    assert.deepEqual(inserts[0].params.slice(0, 4), [
      "call_led_1", "client-a", "org-1", "inquiry_removal"
    ]);
  });

  test("never throws, even if transport explodes", async () => {
    const out = await placeCall({
      phone: "+16616180865",
      task: "Greet.",
      voicemailMessage: DEFAULT_VOICEMAIL_MESSAGE,
      fetchImpl: async () => { throw new Error("socket hang up"); },
      env: LIVE
    });
    assert.equal(out.status, "failed");
    assert.match(out.error, /socket hang up/);
  });

  test("source has no GHL and uses the fenced helper", () => {
    const src = fs.readFileSync(path.join(HERE, "bland-voice.mjs"), "utf8");
    assert.ok(!/GHL_/i.test(src));
    assert.ok(!/\bretell\b/i.test(src));
    assert.ok(src.includes("postJson"));
    assert.ok(src.includes("amd: true"));
    assert.ok(src.includes("voicemail_message"));
  });

  test("inquiry bureau dial uses Experian/Equifax/TransUnion numbers, not the client", async () => {
    const { resolveBureauDial, BUREAU_DISPUTE_DEFAULTS, INQUIRY_VOICE_PROVIDER } =
      await import("./bland-voice.mjs");
    const ex = resolveBureauDial("EX");
    assert.equal(ex.ok, true);
    assert.equal(ex.phone, BUREAU_DISPUTE_DEFAULTS.EX);
    assert.equal(ex.kind, "inquiry_bureau");
    assert.match(ex.task, /Experian|experian/i);
    assert.equal(INQUIRY_VOICE_PROVIDER, "bland_ai");
    assert.equal(resolveBureauDial("NOPE").ok, false);
  });
});
