import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { handleWebhook } from "./router.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";

// Fake db: enough for emit() to insert+dispatch; permissive for handler writes.
// Also models commas_inbox, because the Commas webhook now stores the raw bytes
// before answering rather than emitting on the request path.
function fakeDb() {
  let n = 0;
  let i = 0;
  const inbox = [];
  const db = {
    inbox,
    async query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO commas_inbox/.test(sql)) {
        const [orgId, dedupeKey] = params;
        if (inbox.some((r) => r.org_id === orgId && r.dedupe_key === dedupeKey)) return { rows: [] };
        const row = { id: `inbox-${++i}`, org_id: orgId, dedupe_key: dedupeKey, raw_body: params[4] };
        inbox.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*SELECT id FROM commas_inbox/.test(sql)) {
        const hit = inbox.find((r) => r.dedupe_key === params[1]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/INSERT INTO events/.test(sql)) return { rows: [{ id: `evt-${++n}` }] };
      return { rows: [] };
    }
  };
  return db;
}

function reset() { _resetOrgCache(); clearHandlers(); _resetRegistered(); }

const SECRET = "whsec_router";
const hmac256 = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

const COMMAS_BODY = JSON.stringify({
  id: "txn_r1",
  type: "payment.succeeded",
  data: {
    payment_id: "pay_r1",
    product: { title: "Consulting Services Deposit", price: 3000 },
    fan: { email: "a@b.com" }
  }
});

/* THE HEADER THAT WAS WRONG. Commas signs with `x-webhook-signature`; the
   router named `x-commas-signature`, which no delivery has ever carried, so
   every real payment webhook failed verification and answered 401. */
test("routes a Commas webhook signed with x-webhook-signature → 200, bytes stored", async () => {
  reset();
  const db = fakeDb();
  const out = await handleWebhook({
    db, provider: "commas", rawBody: COMMAS_BODY,
    headers: { "x-webhook-signature": hmac256(COMMAS_BODY) },
    env: { COMMAS_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.queued, true);
  assert.equal(db.inbox.length, 1, "the raw bytes were not made durable");
  assert.equal(db.inbox[0].raw_body, COMMAS_BODY);
});

test("the old x-commas-signature header still works as a fallback", async () => {
  reset();
  const db = fakeDb();
  const out = await handleWebhook({
    db, provider: "commas", rawBody: COMMAS_BODY,
    headers: { "x-commas-signature": hmac256(COMMAS_BODY) },
    env: { COMMAS_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.queued, true);
});

/* The at-most-once contract, asserted at the router: answering must not
   require the money chain to have run. */
test("the Commas route answers without emitting anything on the request path", async () => {
  reset();
  const db = fakeDb();
  let emitted = 0;
  const counting = {
    inbox: db.inbox,
    async query(sql, params) {
      if (/INSERT INTO events/.test(sql)) emitted += 1;
      return db.query(sql, params);
    }
  };
  const out = await handleWebhook({
    db: counting, provider: "commas", rawBody: COMMAS_BODY,
    headers: { "x-webhook-signature": hmac256(COMMAS_BODY) },
    env: { COMMAS_WEBHOOK_SECRET: SECRET }
  });
  assert.equal(out.status, 200);
  assert.equal(emitted, 0, "an event was emitted before the webhook answered");
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
  const providers = ["commas", "clickfunnels", "bland", "twilio", "mailgun", "lendflow"];
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

test("Cal.com is gone — /api/webhooks/calcom and /cal answer 404", async () => {
  for (const provider of ["calcom", "cal"]) {
    reset();
    const out = await handleWebhook({
      db: fakeDb(), provider, rawBody: "{}", headers: {},
      url: `https://x/api/webhooks/${provider}`, env: {}
    });
    assert.equal(out.status, 404, `${provider} must not have an adapter`);
  }
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

test("postgrid webhook route RESOLVES (not 404) — delivery clock entry point", async () => {
  reset();
  const out = await handleWebhook({
    db: fakeDb(),
    provider: "postgrid",
    rawBody: "{}",
    headers: {},
    url: "https://x/api/webhooks/postgrid",
    env: {}
  });
  assert.notEqual(out.status, 404, "/api/webhooks/postgrid must resolve in the router");
  assert.equal(out.status, 401, "unsigned PostGrid webhook fails closed");
});

test("postgrid delivery.confirmed starts call clock off webhook timestamp", async () => {
  reset();
  const secret = "pg_router_secret";
  const deliveredAt = "2026-08-07T14:00:00.000Z";
  const raw = JSON.stringify({
    event: "delivery.confirmed",
    job_id: "letter_router_1",
    status: "delivered",
    timestamp: deliveredAt
  });
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (/FROM inquiry_removal_cases/.test(sql) && /SELECT/i.test(sql)) {
        return {
          rows: [{
            id: "case-1",
            org_id: "org-1",
            client_id: "cl-1",
            selected_bureaus_raw: "EX",
            first_delivery_at: null,
            case_id: "IG-1"
          }]
        };
      }
      if (/FROM ai_bureau_config/.test(sql)) {
        return { rows: [{ portal_wait_business_days: 1, mail_wait_business_days: 3 }] };
      }
      if (/UPDATE inquiry_removal_cases/.test(sql)) {
        return {
          rows: [{
            id: "case-1",
            org_id: "org-1",
            client_id: "cl-1",
            selected_bureaus_raw: "EX",
            first_delivery_at: params[1],
            first_delivery_channel: params[2],
            call_due_at: params[3]
          }]
        };
      }
      return { rows: [] };
    }
  };
  const out = await handleWebhook({
    db,
    provider: "postgrid",
    rawBody: raw,
    headers: { "postgrid-signature": sig },
    url: "https://x/api/webhooks/postgrid",
    env: { POSTGRID_WEBHOOK_SECRET: secret }
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.scheduled, true);
  assert.equal(out.body.waitDays, 3);
  // Fri + 3 business days → Wed; never off send time.
  assert.equal(new Date(out.body.callDueAt).toISOString(), "2026-08-12T14:00:00.000Z");
});
