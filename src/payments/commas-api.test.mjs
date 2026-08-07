import { test } from "node:test";
import assert from "node:assert";
import {
  commasConfig,
  getPayment,
  reconcilePayment,
  DEFAULT_API_BASE,
  API_KEY_ENV
} from "./commas-api.mjs";

/* A fetch stand-in, same seam src/messaging/providers/*.test.mjs uses. */
function fakeFetch(responses = []) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    if (next.throws) throw new Error(next.throws);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => next.body ?? ""
    };
  };
  impl.calls = calls;
  return impl;
}

// --- configuration fails closed --------------------------------------------

/* An unconfigured reconciliation path that quietly reports "nothing to
   reconcile" is worse than one that says it is switched off: the first reads
   as a clean bill of health on the money path. */
test("no API key => not configured, and it SAYS so", () => {
  const cfg = commasConfig({});
  assert.equal(cfg.ok, false);
  assert.match(cfg.reason, new RegExp(API_KEY_ENV));
  assert.match(cfg.reason, /no payment can be reconciled/);
});

test("a key gives a usable config with a trimmed base url", () => {
  assert.equal(commasConfig({ COMMAS_API_KEY: "k" }).base, DEFAULT_API_BASE);
  assert.equal(
    commasConfig({ COMMAS_API_KEY: "k", COMMAS_API_BASE: "https://x.test/api///" }).base,
    "https://x.test/api"
  );
});

test("getPayment refuses to call out when unconfigured", async () => {
  const fetchImpl = fakeFetch([]);
  const res = await getPayment(commasConfig({}), "pay_1", { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(fetchImpl.calls.length, 0, "an unconfigured client still made a network call");
});

// --- the request -----------------------------------------------------------

test("getPayment authenticates and encodes the id into the path", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: JSON.stringify({ payment_id: "pay 1" }) }]);
  const cfg = commasConfig({ COMMAS_API_KEY: "secret-key", COMMAS_API_BASE: "https://x.test" });
  const res = await getPayment(cfg, "pay 1", { fetchImpl });

  assert.equal(res.ok, true);
  assert.equal(fetchImpl.calls[0].url, "https://x.test/payments/pay%201");
  assert.equal(fetchImpl.calls[0].opts.headers.authorization, "Bearer secret-key");
  assert.equal(fetchImpl.calls[0].opts.method, "GET");
});

/* A scheduled pass runs against an API we do not control. One 500 from them
   must not take the pass down — the next pass is the retry. */
test("HTTP errors and transport failures come back as values, never throws", async () => {
  const cfg = commasConfig({ COMMAS_API_KEY: "k" });
  const server500 = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 500, body: "boom" }]) });
  assert.equal(server500.ok, false);
  assert.equal(server500.status, 500);

  const notFound = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 404, body: "" }]) });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404, "a 404 is a data problem and must stay distinguishable");

  const dead = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ throws: "ECONNREFUSED" }]) });
  assert.equal(dead.ok, false);
  assert.match(dead.reason, /unreachable/);

  const garbage = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 200, body: "<html>" }]) });
  assert.equal(garbage.ok, false);
  assert.match(garbage.reason, /invalid_json/);
});

// --- reconciliation lands in the same inbox --------------------------------

function fakeDb() {
  const inbox = [];
  let i = 0;
  return {
    inbox,
    async query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO commas_inbox/.test(sql)) {
        const [orgId, dedupeKey, paymentId, eventType, rawBody, , source] = params;
        if (inbox.some((r) => r.dedupe_key === dedupeKey)) return { rows: [] };
        const row = { id: `inbox-${++i}`, org_id: orgId, dedupe_key: dedupeKey, payment_id: paymentId, event_type: eventType, raw_body: rawBody, source };
        inbox.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*SELECT id FROM commas_inbox/.test(sql)) {
        const hit = inbox.find((r) => r.dedupe_key === params[1]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      return { rows: [] };
    }
  };
}

test("a reconciled payment enters the SAME inbox, marked source=reconcile", async () => {
  const db = fakeDb();
  const payment = { payment_id: "pay_recon_1", amount: 3000, status: "succeeded" };
  const res = await reconcilePayment(db, {
    paymentId: "pay_recon_1",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 200, body: JSON.stringify(payment) }])
  });

  assert.equal(res.ok, true);
  assert.equal(res.enqueued, true);
  assert.equal(db.inbox.length, 1);
  assert.equal(db.inbox[0].source, "reconcile");
  assert.equal(db.inbox[0].payment_id, "pay_recon_1");
  /* GET /payments/:id returns a payment, not a webhook event, so the envelope
     is synthesised. The normaliser must see the shape it expects. */
  const stored = JSON.parse(db.inbox[0].raw_body);
  assert.equal(stored.type, "payment.succeeded");
  assert.deepEqual(stored.data, payment);
});

/* The property that makes reconciling always safe to run, including on a
   payment nobody is sure about — which is the entire point of having it. */
test("reconciling a payment whose webhook DID arrive changes nothing", async () => {
  const db = fakeDb();
  const opts = {
    paymentId: "pay_dup",
    env: { COMMAS_API_KEY: "k" }
  };
  const body = JSON.stringify({ payment_id: "pay_dup", status: "succeeded" });

  const first = await reconcilePayment(db, { ...opts, fetchImpl: fakeFetch([{ status: 200, body }]) });
  const second = await reconcilePayment(db, { ...opts, fetchImpl: fakeFetch([{ status: 200, body }]) });

  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(second.alreadyKnown, true);
  assert.equal(db.inbox.length, 1, "reconciling twice created a second copy of one payment");
});

test("the payload's own status wins over the assumed one", async () => {
  const db = fakeDb();
  await reconcilePayment(db, {
    paymentId: "pay_failed",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 200, body: JSON.stringify({ payment_id: "pay_failed", status: "failed" }) }])
  });
  assert.equal(JSON.parse(db.inbox[0].raw_body).type, "payment.failed");
});

test("an unreachable API enqueues NOTHING rather than a half-built row", async () => {
  const db = fakeDb();
  const res = await reconcilePayment(db, {
    paymentId: "pay_x",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 500, body: "" }])
  });
  assert.equal(res.ok, false);
  assert.equal(res.enqueued, false);
  assert.equal(db.inbox.length, 0);
});

test("with no API key, reconcile does nothing and reports why", async () => {
  const db = fakeDb();
  const res = await reconcilePayment(db, { paymentId: "pay_x", env: {} });
  assert.equal(res.ok, false);
  assert.equal(res.enqueued, false);
  assert.match(res.reason, new RegExp(API_KEY_ENV));
  assert.equal(db.inbox.length, 0);
});
