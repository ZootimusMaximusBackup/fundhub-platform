import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { handleWebhook } from "./router.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";

// Fake db: enough for emit() to insert+dispatch; permissive for handler writes.
function fakeDb() {
  let n = 0;
  return {
    async query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: `evt-${++n}` }] };
      return { rows: [] };
    }
  };
}

function reset() { _resetOrgCache(); clearHandlers(); _resetRegistered(); }

const SECRET = "whsec_router";
const hmac256 = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

test("routes a valid Commas webhook to the adapter → 200 + emitted events", async () => {
  reset();
  const raw = JSON.stringify({ type: "payment.succeeded", id: "txn_r1", data: { product: { title: "Consulting Services Deposit", price: 3000 }, fan: { email: "a@b.com" } } });
  const out = await handleWebhook({
    db: fakeDb(), provider: "commas", rawBody: raw,
    headers: { "x-commas-signature": hmac256(raw) },
    env: { COMMAS_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.emitted.map((e) => e.name), ["payment.received", "deposit.paid"]);
});

test("bad Commas signature → 401 from the adapter", async () => {
  reset();
  const raw = JSON.stringify({ type: "payment.succeeded" });
  const out = await handleWebhook({
    db: fakeDb(), provider: "commas", rawBody: raw,
    headers: { "x-commas-signature": "nope" }, env: { COMMAS_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(out.status, 401);
});

test("unknown provider → 404", async () => {
  reset();
  const out = await handleWebhook({ db: fakeDb(), provider: "myspace", rawBody: "{}", headers: {} });
  assert.equal(out.status, 404);
  assert.match(out.body.error, /unknown provider/);
});

/* This test used to be titled "fails open w/o signing key" and asserted a 200.
   It was encoding a defect: with MAILGUN_SIGNING_KEY unset — which is what
   .env.example ships and what the Netlify env table never mentions — anyone
   could POST a forged payload and have it emitted onto the canonical bus as a
   real mail.response. Every other adapter fails closed; mailgun was the one
   exception, and its own header comment claimed otherwise. */
test("mailgun: no signing key means REFUSE, not accept", async () => {
  reset();
  const raw = JSON.stringify({ "event-data": {}, sender: "bank@lender.com", subject: "Approved", "body-plain": "You are approved", "Message-Id": "<m1>" });
  const out = await handleWebhook({ db: fakeDb(), provider: "mailgun", rawBody: raw, headers: {}, env: {} });
  assert.equal(out.status, 401, "an unsigned mailgun webhook was accepted");
  assert.deepEqual(out.body.emitted, [], "a forged webhook reached the event bus");
});

test("mailgun: a garbage signature is refused even when a key IS configured", async () => {
  reset();
  const raw = JSON.stringify({
    signature: { timestamp: "1", token: "t", signature: "deadbeef" },
    sender: "bank@lender.com", subject: "Approved", "body-plain": "x", "Message-Id": "<m2>"
  });
  const out = await handleWebhook({
    db: fakeDb(), provider: "mailgun", rawBody: raw, headers: {},
    env: { MAILGUN_SIGNING_KEY: "key" }
  });
  assert.equal(out.status, 401);
});

/* THE STRUCTURAL CHECK THAT WAS MISSING. lendflow was written, tested and
   documented as a live inbound webhook, and simply never added to the router's
   table — so /api/webhooks/lendflow answered 404 and the entire round.* event
   family had no producer. Nothing failed, because no test asked "is every
   adapter reachable?". This one does, by enumerating the adapter directory
   rather than a hand-maintained list, so the next adapter cannot be forgotten
   the same way. */
test("every adapter that exports a webhook handler is reachable through the router", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const dir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../adapters");

  const unreachable = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".mjs") || file.includes(".test.")) continue;
    const mod = await import(path.join(dir, file));
    const handler = Object.keys(mod).find((k) => /^handle\w*Webhook$/.test(k));
    if (!handler) continue;                       // not an inbound adapter
    const provider = file.replace(/\.mjs$/, "");
    reset();
    const out = await handleWebhook({
      db: fakeDb(), provider, rawBody: "{}", headers: {},
      url: `https://x/api/webhooks/${provider}`, env: {}
    });
    if (out.status === 404) unreachable.push(`${provider} (exports ${handler})`);
  }
  assert.deepEqual(unreachable, [],
    `adapter(s) exist but /api/webhooks/<name> 404s: ${unreachable.join(", ")}`);
});

test("no adapter accepts an unsigned webhook — all fail closed", async () => {
  const providers = ["commas", "clickfunnels", "bland", "calcom", "twilio", "mailgun", "lendflow"];
  const accepted = [];
  for (const provider of providers) {
    reset();
    const out = await handleWebhook({
      db: fakeDb(), provider, rawBody: JSON.stringify({ type: "x", id: "1" }),
      headers: {}, url: `https://x/api/webhooks/${provider}`, env: {}   // NO secrets
    });
    if (out.status === 200) accepted.push(provider);
  }
  assert.deepEqual(accepted, [],
    `adapter(s) accepted an unsigned webhook with no secret configured: ${accepted.join(", ")}`);
});

test("mailgun: invalid JSON → 400", async () => {
  reset();
  const out = await handleWebhook({ db: fakeDb(), provider: "mailgun", rawBody: "{not json", headers: {}, env: {} });
  assert.equal(out.status, 400);
});

test("twilio route reaches the twilio adapter (no secret → 401, not 404)", async () => {
  reset();
  const out = await handleWebhook({ db: fakeDb(), provider: "twilio", rawBody: "MessageSid=SM1&From=%2B15551234567&Body=hi", headers: {}, url: "https://x/api/webhooks/twilio", env: {} });
  assert.notEqual(out.status, 404, "router recognized twilio");
});
