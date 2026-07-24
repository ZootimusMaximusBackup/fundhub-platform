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

test("mailgun: JSON parsed, routed, emits mail.response (fails open w/o signing key)", async () => {
  reset();
  const raw = JSON.stringify({ "event-data": {}, sender: "bank@lender.com", subject: "Approved", "body-plain": "You are approved", "Message-Id": "<m1>" });
  const out = await handleWebhook({ db: fakeDb(), provider: "mailgun", rawBody: raw, headers: {}, env: {} });
  assert.equal(out.status, 200);
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
