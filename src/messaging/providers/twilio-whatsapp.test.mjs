import { test } from "node:test";
import assert from "node:assert/strict";
import { send, ENABLED, CHANNELS, TRANSMITS } from "./twilio-whatsapp.mjs";

const LIVE = {
  MESSAGING_DRY_RUN: "0",
  TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  TWILIO_SEND_AUTH_TOKEN: "twilio-secret-token-value",
  TWILIO_SEND_FROM: "+15551234567"
};

test("WhatsApp provider is ops-only — not an enabled client channel", () => {
  assert.equal(ENABLED, false);
  assert.equal(TRANSMITS, true);
  assert.ok(CHANNELS.has("whatsapp"));
  assert.equal(CHANNELS.has("sms"), false);
});

test("refuses a destination that is not E.164 — no invented number", async () => {
  const r = await send(
    { to: "", body: "ticket" },
    { env: LIVE, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }) }
  );
  assert.equal(r.status, "rejected");
  assert.match(r.error, /E\.164|DARWIN_WHATSAPP/);
});

test("prefixes whatsapp: and does not throw", async () => {
  const calls = [];
  const r = await send(
    { to: "+15555550123", body: "Fundhub pulse ticket" },
    {
      env: LIVE,
      fetchImpl: async (url, init) => {
        calls.push({ url, body: String(init.body || "") });
        return {
          ok: true,
          status: 201,
          text: async () => JSON.stringify({ sid: "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" })
        };
      }
    }
  );
  assert.equal(r.status, "sent");
  assert.match(calls[0].body, /To=whatsapp%3A%2B15555550123/);
});
