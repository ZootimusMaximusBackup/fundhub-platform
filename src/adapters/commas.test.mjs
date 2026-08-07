import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyCommasSignature,
  normalizeCommasEvent,
  productOf,
  mapToCanonical,
  handleCommasWebhook,
  processCommasInboxRow,
  buildCommasCheckoutUrl,
  paymentIdOf,
  eventTypeOf,
  SIGNATURE_HEADERS
} from "./commas.mjs";
import { drain, dedupeKeyFor } from "../payments/commas-inbox.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

/* Fake db — now models BOTH tables the payment path touches.
 *
 * It models the two unique indexes that carry the money guarantees, because a
 * fake that ignores them lets a test pass while the real thing double-counts:
 *
 *   events        ON CONFLICT (org_id, idempotency_key) DO NOTHING
 *   commas_inbox  ON CONFLICT (org_id, dedupe_key)      DO NOTHING
 *
 * The inbox is the one that matters most now. Under at-most-once delivery the
 * inbox key is the FIRST line of defence against a re-delivery — it stops the
 * duplicate before the payload has even been interpreted. */
function fakeDb({ dedupEvents = false, store = [], inbox = [] } = {}) {
  let n = 0;
  let inboxN = 0;
  const eventKeys = new Set();

  return {
    inbox,
    store,
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };

      // --- commas_inbox -----------------------------------------------------
      if (/INSERT INTO commas_inbox/.test(sql)) {
        const [orgId, dedupeKey, paymentId, eventType, rawBody, headers, source] = params;
        if (inbox.some((r) => r.org_id === orgId && r.dedupe_key === dedupeKey)) {
          return { rows: [] }; // unique index absorbed it
        }
        const row = {
          id: `inbox-${++inboxN}`,
          org_id: orgId,
          dedupe_key: dedupeKey,
          payment_id: paymentId,
          event_type: eventType,
          raw_body: rawBody,
          headers,
          source,
          status: "pending",
          attempts: 0,
          last_error: null
        };
        inbox.push(row);
        return { rows: [{ id: row.id }] };
      }
      /* ANCHORED. The claim statement below contains "SELECT id FROM
         commas_inbox" inside its own subquery, so an unanchored match here
         swallows the claim and every sweep silently returns zero rows. */
      if (/^\s*SELECT id FROM commas_inbox/.test(sql)) {
        const [orgId, dedupeKey] = params;
        const hit = inbox.find((r) => r.org_id === orgId && r.dedupe_key === dedupeKey);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/UPDATE commas_inbox/.test(sql) && /status = 'processing'/.test(sql)) {
        const limit = params[2];
        const claimable = inbox
          .filter((r) => ["pending", "failed"].includes(r.status))
          .slice(0, limit);
        for (const r of claimable) { r.status = "processing"; r.attempts += 1; }
        return { rows: claimable.map((r) => ({ ...r })) };
      }
      if (/UPDATE commas_inbox/.test(sql)) {
        const id = params[0];
        const row = inbox.find((r) => r.id === id);
        if (row) {
          if (/status = 'done'/.test(sql)) row.status = "done";
          else if (/status = 'ignored'/.test(sql)) { row.status = "ignored"; row.last_error = params[1]; }
          else if (/status = 'failed'/.test(sql)) { row.status = "failed"; row.last_error = params[1]; }
        }
        return { rows: [] };
      }

      // --- events -----------------------------------------------------------
      if (/INSERT INTO events/.test(sql)) {
        if (dedupEvents) return { rows: [] };
        const idem = params[3];
        if (idem != null) {
          const k = `${params[0]}|${idem}`;
          if (eventKeys.has(k)) return { rows: [] };
          eventKeys.add(k);
        }
        const row = { id: `evt-${++n}` };
        store.push({ ...row, name: params[1], payload: params[5], idempotency_key: idem });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

/* deliver — the whole path a real payment takes: webhook stores and answers,
   then a sweep pass interprets. Anything asserting on emitted events has to go
   through both halves now, because the first half deliberately decides
   nothing. */
async function deliver(db, rawBody, { signatureHeader } = {}) {
  const ack = await handleCommasWebhook({
    db,
    rawBody,
    signatureHeader: signatureHeader ?? sign(rawBody),
    secret: SECRET
  });
  const swept = ack.ok
    ? await drain(db, { process: processCommasInboxRow })
    : { claimed: 0, counts: {} };
  return { ack, swept };
}

// --- signature -------------------------------------------------------------
test("verifyCommasSignature: accepts valid, rejects tampered / missing", () => {
  const raw = JSON.stringify({ hi: 1 });
  assert.equal(verifyCommasSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyCommasSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed
  assert.equal(verifyCommasSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyCommasSignature(raw, "", SECRET), false);
  assert.equal(verifyCommasSignature(raw, sign(raw), null), false); // no secret => closed
});

test("the documented header is checked FIRST, the old name kept as fallback", () => {
  // The adapter was wired to x-commas-signature, which no delivery has ever
  // carried — every real payment 401'd. Order is the fix, so order is asserted.
  assert.deepEqual(SIGNATURE_HEADERS, ["x-webhook-signature", "x-commas-signature"]);
});

// --- two payload shapes ----------------------------------------------------
/* Real deliveries are enveloped. The dashboard's Test Webhook button sends
   payment.succeeded FLAT. Validating against the test button alone proves
   nothing about production, so both shapes are fixtures. */

const LIVE_ENVELOPE = JSON.stringify({
  id: "evt_delivery_001",
  type: "payment.succeeded",
  created_at: "2026-08-06T04:00:00Z",
  data: {
    payment_id: "pay_live_1",
    amount: 3000,
    product: { title: "Consulting Services Deposit", price: 3000 },
    fan: { email: "live@example.com" }
  }
});

const FLAT_TEST_EVENT = JSON.stringify({
  type: "payment.succeeded",
  payment_id: "pay_flat_1",
  amount: 32,
  product_name: "Business Financial Assessment",
  email: "flat@example.com"
});

test("normalize reads the LIVE ENVELOPE shape ({id,type,data,created_at})", () => {
  const evt = normalizeCommasEvent(JSON.parse(LIVE_ENVELOPE));
  assert.equal(evt.type, "payment.succeeded");
  assert.equal(evt.paymentId, "pay_live_1");
  assert.equal(evt.name, "Consulting Services Deposit");
  assert.equal(evt.amount, 3000);
  assert.equal(evt.email, "live@example.com");
});

test("normalize reads the FLAT test-button shape (no envelope)", () => {
  const evt = normalizeCommasEvent(JSON.parse(FLAT_TEST_EVENT));
  assert.equal(evt.type, "payment.succeeded");
  assert.equal(evt.paymentId, "pay_flat_1");
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.amount, 32);
  assert.equal(evt.email, "flat@example.com");
});

test("paymentIdOf / eventTypeOf work on both shapes and never throw", () => {
  assert.equal(paymentIdOf(JSON.parse(LIVE_ENVELOPE)), "pay_live_1");
  assert.equal(paymentIdOf(JSON.parse(FLAT_TEST_EVENT)), "pay_flat_1");
  assert.equal(eventTypeOf(JSON.parse(LIVE_ENVELOPE)), "payment.succeeded");
  assert.equal(eventTypeOf(JSON.parse(FLAT_TEST_EVENT)), "payment.succeeded");
  assert.equal(paymentIdOf(null), null);
  assert.equal(eventTypeOf(undefined), "");
  assert.equal(paymentIdOf({}), null);
});

test("normalizeCommasEvent: reads FanBasis SDK shape (data.product / data.fan)", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    id: "txn_123",
    data: {
      product: { title: "Business Financial Assessment", price: 32 },
      fan: { email: "JANE@EXAMPLE.com" }
    }
  });
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.amount, 32);
  assert.equal(evt.email, "jane@example.com"); // lowercased/trimmed
  assert.equal(evt.id, "txn_123");
});

test("normalizeCommasEvent: amount_cents downscales, missing amount => null", () => {
  assert.equal(normalizeCommasEvent({ data: { amount_cents: 300000 } }).amount, 3000);
  assert.equal(normalizeCommasEvent({ data: { product: { title: "x" } } }).amount, null);
});

test("normalizeCommasEvent: carries a dispute deadline through as dueBy", () => {
  const evt = normalizeCommasEvent({
    type: "dispute.created",
    data: { payment_id: "pay_d", due_by: "2026-08-20T00:00:00Z", amount: 500 }
  });
  assert.equal(evt.dueBy, "2026-08-20T00:00:00Z");
  assert.equal(normalizeCommasEvent({ data: {} }).dueBy, null, "must not invent a deadline");
});

// --- product routing (name only, never amount) -----------------------------
test("productOf: routes strictly by product name", () => {
  assert.equal(productOf({ name: "Business Financial Assessment" }), "crs");
  assert.equal(productOf({ name: "Consulting Services Deposit" }), "deposit");
  assert.equal(productOf({ name: "Consulting Success Fee" }), "success_fee");
  assert.equal(productOf({ name: "Consulting Services Package" }), "diy");
  assert.equal(productOf({ name: "Mystery Box" }), "unmatched");
});

// --- canonical mapping -----------------------------------------------------
test("mapToCanonical: $32 CRS => payment.received + diagnostic.paid", () => {
  const names = mapToCanonical({ type: "payment.succeeded", name: "Business Financial Assessment" }).map((c) => c.name);
  assert.deepEqual(names, ["payment.received", "diagnostic.paid"]);
});

test("mapToCanonical: deposit => deposit.paid, diy => sale.closed", () => {
  assert.deepEqual(
    mapToCanonical({ type: "payment.succeeded", name: "Consulting Services Deposit" }).map((c) => c.name),
    ["payment.received", "deposit.paid"]
  );
  assert.deepEqual(
    mapToCanonical({ type: "payment.succeeded", name: "Consulting Services Package" }).map((c) => c.name),
    ["payment.received", "sale.closed"]
  );
});

test("mapToCanonical: failed => payment.failed only; unmatched succeeded => payment.received only", () => {
  assert.deepEqual(mapToCanonical({ type: "payment.failed", name: "x" }).map((c) => c.name), ["payment.failed"]);
  assert.deepEqual(mapToCanonical({ type: "payment.succeeded", name: "Mystery Box" }).map((c) => c.name), [
    "payment.received"
  ]);
  assert.deepEqual(mapToCanonical({ type: "checkout.pending", name: "x" }), []); // non-terminal ignored
});

/* THE DECLINE-METRIC RULE. expired and canceled are abandoned checkouts, not
   declines. Mapping them onto payment.failed would inflate the decline rate
   with people who were never declined. */
test("expired / canceled are ops-only: never payment.failed, never money", () => {
  const expired = mapToCanonical({ type: "payment.expired", name: "Consulting Services Deposit" });
  const canceled = mapToCanonical({ type: "payment.canceled", name: "Consulting Services Deposit" });

  assert.deepEqual(expired.map((c) => c.name), ["payment.expired"]);
  assert.deepEqual(canceled.map((c) => c.name), ["payment.canceled"]);

  for (const set of [expired, canceled]) {
    const names = set.map((c) => c.name);
    assert.ok(!names.includes("payment.failed"), "an abandoned checkout was counted as a decline");
    assert.ok(!names.includes("payment.received"), "an abandoned checkout credited money");
    assert.ok(!names.includes("deposit.paid"), "an abandoned checkout advanced the journey");
  }
  // British spelling must not fall through to succeeded either.
  assert.deepEqual(
    mapToCanonical({ type: "payment.cancelled", name: "x" }).map((c) => c.name),
    ["payment.canceled"]
  );
});

test("refund.created and dispute.created map to their own events, crediting nothing", () => {
  const refund = mapToCanonical({ type: "refund.created", name: "Consulting Services Deposit" });
  const dispute = mapToCanonical({ type: "dispute.created", name: "Consulting Services Deposit" });
  assert.deepEqual(refund.map((c) => c.name), ["payment.refunded"]);
  assert.deepEqual(dispute.map((c) => c.name), ["payment.disputed"]);
  for (const set of [refund, dispute]) {
    assert.ok(!set.some((c) => c.name === "payment.received"), "money was credited a second time");
  }
});

// --- ACK BEFORE WORK -------------------------------------------------------

test("the webhook answers 200 having done nothing but store the bytes", async () => {
  _resetOrgCache(); clearHandlers();
  let handlerRan = false;
  on("deposit.paid", () => { handlerRan = true; });

  const db = fakeDb();
  const ack = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET
  });

  assert.equal(ack.ok, true);
  assert.equal(ack.status, 200);
  assert.equal(ack.queued, true);
  assert.equal(db.inbox.length, 1, "the bytes were not made durable before answering");
  assert.equal(db.inbox[0].raw_body, LIVE_ENVELOPE, "stored bytes differ from what was signed");
  assert.equal(db.inbox[0].payment_id, "pay_live_1");

  // The whole point: no interpretation, no events, no handlers, before the 200.
  assert.equal(db.store.length, 0, "an event was emitted on the request path");
  assert.equal(handlerRan, false, "a handler ran on the request path");
});

test("bad signature => 401 and NOTHING is stored", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const res = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: "nope", secret: SECRET
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.queued, false);
  assert.equal(db.inbox.length, 0);
});

test("a signed but UNPARSEABLE body is still stored, not refused", async () => {
  /* It carries a valid signature, so it really came from Commas. A payload we
     could not parse but kept is a bug report; one we refused is a lost
     payment. */
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = "{not json at all";
  const ack = await handleCommasWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(ack.status, 200);
  assert.equal(db.inbox.length, 1);
  assert.match(ack.reason, /^stored_unparseable/);

  // And it terminates rather than retrying forever.
  const swept = await drain(db, { process: processCommasInboxRow });
  assert.equal(swept.counts.ignored, 1);
  assert.equal(db.inbox[0].status, "ignored");
});

test("if the inbox write fails the caller gets 5xx, never a false 200", async () => {
  _resetOrgCache(); clearHandlers();
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      throw new Error("database is down");
    }
  };
  const res = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.equal(res.reason, "inbox_write_failed");
});

// --- phase two: the sweep --------------------------------------------------

test("the sweep turns a stored deposit into both canonical events + handlers", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("deposit.paid", (e) => seen.push(e.name));
  on("payment.received", (e) => seen.push(e.name));

  const db = fakeDb();
  const { ack, swept } = await deliver(db, LIVE_ENVELOPE);

  assert.equal(ack.status, 200);
  assert.equal(swept.counts.done, 1);
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "deposit.paid"]);
  assert.deepEqual(seen.sort(), ["deposit.paid", "payment.received"]);
  assert.equal(db.inbox[0].status, "done");
});

test("the FLAT test-button payload survives the whole path too", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const { swept } = await deliver(db, FLAT_TEST_EVENT);
  assert.equal(swept.counts.done, 1);
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "diagnostic.paid"]);
});

test("a non-terminal event is stored, then terminates as ignored", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({ type: "checkout.pending", data: { payment_id: "pay_p" } });
  const { ack, swept } = await deliver(db, raw);
  assert.equal(ack.status, 200);
  assert.equal(swept.counts.ignored, 1);
  assert.equal(db.store.length, 0);
  assert.match(db.inbox[0].last_error, /no_canonical_mapping/);
});

// --- IDEMPOTENCY: the payment id, not the envelope id ----------------------

/* THE BUG THIS TEST EXISTS FOR. Commas' envelope `id` is per-DELIVERY. The
   adapter used to key on it, so two deliveries of one payment carried two keys,
   both looked new, and the deposit was counted twice. */
test("two deliveries of ONE payment, different envelope ids, count once", async () => {
  _resetOrgCache(); clearHandlers();
  let depositHandlerRuns = 0;
  on("deposit.paid", () => { depositHandlerRuns += 1; });

  const db = fakeDb();
  const mk = (envelopeId) => JSON.stringify({
    id: envelopeId,               // differs per delivery
    type: "payment.succeeded",
    data: {
      payment_id: "pay_same_1",   // the actual payment — identical
      amount: 3000,
      product: { title: "Consulting Services Deposit", price: 3000 },
      fan: { email: "twice@example.com" }
    }
  });

  const first = await deliver(db, mk("evt_delivery_A"));
  const second = await deliver(db, mk("evt_delivery_B"));

  assert.equal(first.ack.queued, true);
  assert.equal(second.ack.queued, false, "the second delivery was treated as new money");
  assert.equal(second.ack.deduped, true);
  assert.equal(db.inbox.length, 1, "one payment produced two inbox rows");
  assert.equal(depositHandlerRuns, 1, "the deposit was counted twice");
  assert.equal(db.store.filter((e) => e.name === "payment.received").length, 1);
});

test("one payment's DIFFERENT events do not collapse into each other", async () => {
  // succeeded, then later refunded — same payment id, two real events.
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const succeeded = JSON.stringify({
    id: "evt_1", type: "payment.succeeded",
    data: { payment_id: "pay_x", amount: 500, product: { title: "Mystery Box" } }
  });
  const refunded = JSON.stringify({
    id: "evt_2", type: "refund.created",
    data: { payment_id: "pay_x", amount: 500, product: { title: "Mystery Box" } }
  });
  await deliver(db, succeeded);
  await deliver(db, refunded);

  assert.equal(db.inbox.length, 2, "a refund was swallowed by its own payment's dedupe key");
  const names = db.store.map((e) => e.name);
  assert.ok(names.includes("payment.received"));
  assert.ok(names.includes("payment.refunded"));
});

test("a webhook with NO payment id still dedupes on replay", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email: "noid@example.com" }
  });
  const first = await deliver(db, raw);
  const second = await deliver(db, raw);

  assert.equal(first.ack.queued, true);
  assert.equal(second.ack.deduped, true, "a replayed id-less webhook was stored twice");
  assert.equal(db.inbox.length, 1);
  assert.ok(db.store.every((e) => e.idempotency_key), "an event was written with no idempotency key");
});

test("id-less webhooks with DIFFERENT bytes are not collapsed", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const mk = (email) => JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email }
  });
  await deliver(db, mk("a@example.com"));
  await deliver(db, mk("b@example.com"));
  assert.equal(db.inbox.length, 2, "two different payments were collapsed into one");
});

test("dedupeKeyFor prefers the payment id and falls back to a body hash", () => {
  assert.equal(
    dedupeKeyFor({ paymentId: "pay_1", eventType: "payment.succeeded" }),
    "pay_1:payment.succeeded"
  );
  const hashed = dedupeKeyFor({ paymentId: null, eventType: "payment.succeeded", rawBody: "{}" });
  assert.match(hashed, /^body:[0-9a-f]{64}:payment\.succeeded$/);
});

// --- payload reaching handlers ---------------------------------------------

test("a payment link's ref reaches the emitted payment.received payload", async () => {
  _resetOrgCache(); clearHandlers();
  let seenPayload = null;
  on("payment.received", (e) => { seenPayload = e.payload; });
  const raw = JSON.stringify({
    type: "payment.succeeded",
    id: "txn_link_1",
    data: {
      payment_id: "pay_link_1",
      product: { title: "Mystery Box", price: 250 },
      fan: { email: "a@b.com" },
      client_reference_id: "pl_xyz"
    }
  });
  await deliver(fakeDb(), raw);
  assert.ok(seenPayload, "payment.received never dispatched");
  assert.equal(seenPayload.ref, "pl_xyz");
  assert.equal(seenPayload.paymentId, "pay_link_1");
  assert.equal(seenPayload.providerRef, "pay_link_1", "providerRef must be the stable payment id");
});

test("a dispute's deadline reaches the payload so the task can carry it", async () => {
  _resetOrgCache(); clearHandlers();
  let seen = null;
  on("payment.disputed", (e) => { seen = e.payload; });
  const raw = JSON.stringify({
    type: "dispute.created",
    id: "evt_d",
    data: {
      payment_id: "pay_disputed",
      amount: 3000,
      due_by: "2026-08-20T00:00:00Z",
      product: { title: "Consulting Services Deposit" },
      fan: { email: "angry@example.com" }
    }
  });
  await deliver(fakeDb(), raw);
  assert.ok(seen, "payment.disputed never dispatched");
  assert.equal(seen.dueBy, "2026-08-20T00:00:00Z");
  assert.equal(seen.amount, 3000);
});

// --- failure handling in the sweep -----------------------------------------

test("one poison row does not stop the payments queued behind it", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  await handleCommasWebhook({ db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET });
  await handleCommasWebhook({ db, rawBody: FLAT_TEST_EVENT, signatureHeader: sign(FLAT_TEST_EVENT), secret: SECRET });

  /* One batch, so each row is attempted exactly once and the counts describe
     that pass rather than its retries. The first row is permanently poisoned;
     the question is whether the second still gets processed. */
  const poisonedId = db.inbox[0].id;
  const swept = await drain(db, {
    maxBatches: 1,
    process: async (row, database) => {
      if (row.id === poisonedId) throw new Error("boom");
      return processCommasInboxRow(row, database);
    }
  });

  assert.equal(swept.counts.failed, 1);
  assert.equal(swept.counts.done, 1, "the good payment behind the bad one was not processed");
  assert.equal(db.inbox[0].status, "failed");
  assert.equal(db.inbox[0].last_error, "boom");
  assert.equal(db.inbox[1].status, "done");
});

// --- payment links: outbound checkout URL + inbound ref round-trip ---------

test("buildCommasCheckoutUrl: amount in dollars, ref and description on the query string", () => {
  const url = buildCommasCheckoutUrl({
    baseUrl: "https://pay.commas.io/c/onboarding",
    linkRef: "pl_abc123",
    amountCents: 250000,
    description: "Onboarding deposit"
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://pay.commas.io/c/onboarding");
  assert.equal(parsed.searchParams.get("amount"), "2500.00");
  assert.equal(parsed.searchParams.get("ref"), "pl_abc123");
  assert.equal(parsed.searchParams.get("description"), "Onboarding deposit");
});

test("buildCommasCheckoutUrl: description is optional, everything else is not", () => {
  const url = buildCommasCheckoutUrl({ baseUrl: "https://pay.commas.io/c/x", linkRef: "pl_1", amountCents: 100 });
  assert.equal(new URL(url).searchParams.has("description"), false);
  assert.throws(() => buildCommasCheckoutUrl({ linkRef: "pl_1", amountCents: 100 }), TypeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", amountCents: 100 }), TypeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", linkRef: "pl_1", amountCents: 0 }), RangeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", linkRef: "pl_1", amountCents: 19.5 }), RangeError);
});

test("normalizeCommasEvent: reads a client_reference_id back as ref", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    id: "txn_1",
    data: { product: { title: "x" }, client_reference_id: "pl_abc123" }
  });
  assert.equal(evt.ref, "pl_abc123");
});

test("normalizeCommasEvent: ref falls back through metadata.link_ref / metadata.ref / reference / ref", () => {
  assert.equal(normalizeCommasEvent({ data: { metadata: { link_ref: "pl_a" } } }).ref, "pl_a");
  assert.equal(normalizeCommasEvent({ data: { metadata: { ref: "pl_b" } } }).ref, "pl_b");
  assert.equal(normalizeCommasEvent({ data: { reference: "pl_c" } }).ref, "pl_c");
  assert.equal(normalizeCommasEvent({ data: { ref: "pl_d" } }).ref, "pl_d");
  assert.equal(normalizeCommasEvent({ data: {} }).ref, null, "no ref anywhere must not invent one");
});
