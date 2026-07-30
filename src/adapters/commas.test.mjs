import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyCommasSignature,
  normalizeCommasEvent,
  productOf,
  mapToCanonical,
  handleCommasWebhook
} from "./commas.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

/* Fake db (same shape as bus.test.mjs) — routes by SQL keyword.

   It now MODELS THE UNIQUE INDEX. It used to ignore idempotency_key entirely
   and insert unconditionally, so no test using it could observe whether emit()
   was given a key — a replay test written against it was really testing the
   fake. events has `ON CONFLICT (org_id, idempotency_key) DO NOTHING`, so the
   fake honours the same rule: a repeated non-null key returns no row. */
function fakeDb({ dedup = false, store = [] } = {}) {
  let n = 0;
  const keys = new Set();
  return {
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO events/.test(sql)) {
        if (dedup) return { rows: [] };
        const idem = params[3];                       // idempotency_key
        if (idem != null) {
          const k = `${params[0]}|${idem}`;           // (org_id, idempotency_key)
          if (keys.has(k)) return { rows: [] };       // DO NOTHING
          keys.add(k);
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

// --- signature -------------------------------------------------------------
test("verifyCommasSignature: accepts valid, rejects tampered / missing", () => {
  const raw = JSON.stringify({ hi: 1 });
  assert.equal(verifyCommasSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyCommasSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed
  assert.equal(verifyCommasSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyCommasSignature(raw, "", SECRET), false);
  assert.equal(verifyCommasSignature(raw, sign(raw), null), false); // no secret => closed
});

// --- normalize -------------------------------------------------------------
test("normalizeCommasEvent: reads FanBasis SDK shape (data.product / data.fan)", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    id: "txn_123",
    data: {
      product: { title: "Business Financial Assessment", price: 32 },
      fan: { email: "JANE@EXAMPLE.com" }
    }
  });
  assert.equal(evt.type, "payment.succeeded");
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.amount, 32);
  assert.equal(evt.email, "jane@example.com"); // lowercased/trimmed
  assert.equal(evt.id, "txn_123");
});

test("normalizeCommasEvent: amount_cents downscales, missing amount => null", () => {
  assert.equal(normalizeCommasEvent({ data: { amount_cents: 300000 } }).amount, 3000);
  assert.equal(normalizeCommasEvent({ data: { product: { title: "x" } } }).amount, null);
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

// --- full adapter ----------------------------------------------------------
test("handleCommasWebhook: bad signature => 401, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ type: "payment.succeeded" });
  const res = await handleCommasWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: "nope", secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.emitted.length, 0);
});

test("handleCommasWebhook: deposit payment emits both events + dispatches handlers", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("deposit.paid", (e) => seen.push(e.name));
  on("payment.received", (e) => seen.push(e.name));
  const raw = JSON.stringify({
    type: "payment.succeeded",
    id: "txn_dep_1",
    data: { product: { title: "Consulting Services Deposit", price: 3000 }, fan: { email: "a@b.com" } }
  });
  const res = await handleCommasWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.emitted.map((e) => e.name), ["payment.received", "deposit.paid"]);
  assert.deepEqual(seen.sort(), ["deposit.paid", "payment.received"]);
});

test("handleCommasWebhook: re-delivered webhook is idempotent (deduped, no dispatch)", async () => {
  _resetOrgCache(); clearHandlers();
  let fired = 0;
  on("diagnostic.paid", () => (fired += 1));
  const raw = JSON.stringify({
    type: "payment.succeeded",
    id: "txn_crs_1",
    data: { product: { title: "Business Financial Assessment", price: 32 }, fan: { email: "a@b.com" } }
  });
  const db = fakeDb({ dedup: true }); // simulate the events row already existing
  const res = await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.ok(res.emitted.every((e) => e.deduped === true), "all events deduped");
  assert.equal(fired, 0, "handler must not fire on a deduped replay");
});

test("handleCommasWebhook: non-terminal event => 200, ignored, no emit", async () => {
  _resetOrgCache(); clearHandlers();
  const raw = JSON.stringify({ type: "checkout.pending" });
  const res = await handleCommasWebhook({ db: fakeDb(), rawBody: raw, signatureHeader: sign(raw), secret: SECRET });
  assert.equal(res.ok, true);
  assert.equal(res.emitted.length, 0);
  assert.match(res.reason, /^ignored:/);
});

/* ── replay safety when the provider sends no event id ──────────────────────
   evt.id has four fallbacks and can still be null. It used to mean NO
   idempotency key, so a redelivered webhook emitted a second payment.received
   and the money was counted twice. */

test("a webhook with NO event id still dedupes on replay", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = fakeDb({ store });
  // No id / transaction_id / checkout_session_id / fan.id anywhere.
  const raw = JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email: "noid@example.com" }
  });
  const sig = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

  const first = await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sig, secret: SECRET });
  const second = await handleCommasWebhook({ db, rawBody: raw, signatureHeader: sig, secret: SECRET });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.ok(first.emitted.length >= 1, "the first delivery emitted nothing");
  assert.equal(store.length, first.emitted.length,
    `a replayed id-less webhook emitted again: ${store.length} rows`);
  assert.ok(store.every((e) => e.idempotency_key),
    "an event was written with no idempotency key at all");
});

test("an id-less webhook with DIFFERENT bytes is not collapsed", async () => {
  _resetOrgCache(); clearHandlers();
  const store = [];
  const db = fakeDb({ store });
  const mk = (email) => JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email }
  });
  let expected = 0;
  for (const email of ["a@example.com", "b@example.com"]) {
    const raw = mk(email);
    const r = await handleCommasWebhook({
      db, rawBody: raw, secret: SECRET,
      signatureHeader: crypto.createHmac("sha256", SECRET).update(raw).digest("hex")
    });
    expected += r.emitted.length;   // this product maps to TWO canonical events
  }
  assert.equal(store.length, expected,
    "two different payments were collapsed into one");
  const keys = store.map((e) => e.idempotency_key);
  assert.equal(new Set(keys).size, keys.length, "distinct payments shared an idempotency key");
});
