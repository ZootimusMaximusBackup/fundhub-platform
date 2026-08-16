// Commas (formerly FanBasis) payment adapter — Master Rebuild Spec Phase 1 (B2).
//
// Commas IS the payment processor. In the platform model an adapter does exactly
// three things and NOTHING else:
//   1. verify the webhook signature (fail-closed),
//   2. normalize the raw body into a flat event,
//   3. emit canonical events onto the bus — handlers (registered elsewhere) react.
//
// This is the port of the live underwrite-iq-lite `commas-payment.js` handler.
// The DIFFERENCE: the live handler does GHL/Airtable side effects inline; here the
// adapter only translates money-in → canonical events. The GHL/Airtable/CRS effects
// become handlers on those events (so the same payment can drive many reactions,
// and replay() re-drives them). Routing stays STRICTLY on product NAME, never amount
// (Chris 2026-07-17: deposit + package prices vary per client).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM the SIG header + body field paths against a real Commas sandbox   │
// │ payload. The paths below match the live handler + the @fanbasis/checkout-sdk │
// │ shape (data.fan.email, data.product.title/price). Adjust only normalize().   │
// └───────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit, defaultOrgId } from "../events/bus.mjs";
import { enqueue } from "../payments/commas-inbox.mjs";

/* The signature header, in the order we look for it.
 *
 * Commas sends `x-webhook-signature`. This adapter was wired to
 * `x-commas-signature`, which no delivery has ever carried, so every real
 * webhook failed verification and answered 401 — the 401s that were being
 * treated as a secret problem. The old name stays as a fallback because it
 * costs nothing and something may still be pointed at it, but the documented
 * name is checked first. */
export const SIGNATURE_HEADERS = ["x-webhook-signature", "x-commas-signature"];

// Product routing — name match only. Same strings as the live handler.
export const PRODUCT = {
  CRS: { nameIncludes: "business financial assessment" }, // $32 soft-pull gate
  DEPOSIT: { nameIncludes: "consulting services deposit" }, // variable onboarding deposit
  SUCCESS_FEE: { nameIncludes: "consulting success fee" }, // variable success fee
  DIY: { nameIncludes: "consulting services package" } // $1,000 DIY letters downsell (DS-02)
};

// --- 1. Signature verification (fail-closed) --------------------------------
// HMAC-SHA256 of the raw body, keyed by the Commas signing secret. Some processors
// prefix the header ("sha256=..."); accept the raw hex tail. Returns false on any
// mismatch / malformed input — the caller MUST refuse the request when false.
export function verifyCommasSignature(rawBody, providedHeader, secret) {
  if (!secret) return false;
  const provided = String(providedHeader || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/* TWO PAYLOAD SHAPES, AND ONLY ONE OF THEM IS REAL TRAFFIC.
 *
 * A real delivery is always enveloped: { id, type, data, created_at }. The
 * dashboard's "Test Webhook" button sends payment.succeeded and the core
 * subscription events FLAT, with no envelope at all. Validating the parser
 * against the test button therefore proves nothing about production, which is
 * how a parser can look correct and still miss every live payment.
 *
 * `body.data || body` below is what absorbs the difference, and the fixtures
 * in commas.test.mjs cover both shapes deliberately. */
const inner = (b) => (b && b.data && (b.data.object || b.data)) || b || {};

/* eventTypeOf / paymentIdOf — the two fields needed BEFORE the payload is
 * interpreted, because the inbox row has to be written and answered in the
 * time budget of a webhook. Kept tiny and total: neither throws, and either
 * may return null, because an unparseable body must still be stored. */
export function eventTypeOf(body) {
  const b = body || {};
  return String(b.type || b.event || b.event_type || inner(b).type || "").toLowerCase();
}

/* THE IDEMPOTENCY ANCHOR. Commas documents `data.payment_id` as the stable
   identifier for a payment and the envelope `id` as per-DELIVERY. Keying on
   the envelope means two deliveries of one payment look like two payments and
   the money is counted twice. */
export function paymentIdOf(body) {
  const b = body || {};
  const d = inner(b);
  const id = d.payment_id ?? b.payment_id ?? d.paymentId ?? b.paymentId ?? null;
  return id ? String(id) : null;
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Mirrors extractEvent() in the live handler verbatim, plus an `id` for idempotency.
export function normalizeCommasEvent(body) {
  const b = body || {};
  const d = (b.data && (b.data.object || b.data)) || b;
  const type = String(b.type || b.event || b.event_type || d.type || "").toLowerCase();

  // amount: prefer major-unit fields; fall back to minor units (cents) / 100.
  let amount =
    d.amount ??
    d.amount_total ??
    d.total ??
    d.price ??
    (d.product && d.product.price) ??
    b.amount ??
    b.amount_total;
  if ((amount === undefined || amount === null) && typeof d.amount_cents === "number") {
    amount = d.amount_cents / 100;
  }
  amount = amount === undefined || amount === null || amount === "" ? null : Number(amount);
  if (Number.isNaN(amount)) amount = null;

  const li =
    (Array.isArray(d.line_items) && d.line_items[0]) ||
    (Array.isArray(d.items) && d.items[0]) ||
    {};
  const name =
    (d.item && d.item.title) ||
    d.product_name ||
    (d.product && (d.product.name || d.product.title)) ||
    li.name ||
    li.product_name ||
    (li.price && li.price.product && li.price.product.name) ||
    d.name ||
    b.product_name ||
    "";

  const email =
    (d.buyer && d.buyer.email) ||
    (d.fan && (d.fan.email || d.fan.email_address)) ||
    d.customer_email ||
    (d.customer && (d.customer.email || d.customer.email_address)) ||
    d.email ||
    d.email_address ||
    (d.billing && d.billing.email) ||
    b.email ||
    "";

  // Stable id for idempotency: the processor's event/transaction id.
  const id =
    b.id ||
    b.event_id ||
    d.id ||
    d.transaction_id ||
    d.checkout_session_id ||
    (d.fan && d.fan.id ? `${d.fan.id}:${name}` : null) ||
    null;

  /* ref — OUR OWN reference, round-tripped through the checkout link built by
     buildCommasCheckoutUrl() below and (assumed to be) echoed back on the
     webhook. This is how a payment_links row (119_payment_links.sql) finds its
     way from 'sent' to 'paid': `id` above is the PROCESSOR's transaction id,
     known only after payment, so it cannot be the thing a link is looked up
     by. Same CONFIRM caveat as every other field path in this file — the
     exact key Commas echoes a client reference back under has not been
     observed against a live payload. Checked in the order a checkout-link
     integration is most likely to carry it: an explicit reference id, then a
     generic metadata bag, then a bare `ref` some processors use verbatim. */
  const ref =
    (d.api_metadata && d.api_metadata.data &&
      (d.api_metadata.data.link_ref || d.api_metadata.data.ref)) ||
    d.client_reference_id ||
    (d.metadata && (d.metadata.link_ref || d.metadata.ref)) ||
    d.reference ||
    d.ref ||
    b.client_reference_id ||
    b.ref ||
    null;

  /* dueBy — a dispute's response deadline. Missing it is how a chargeback is
     lost by default, so it is carried through to the task rather than left in
     the raw body for somebody to find. */
  const dueByRaw = d.due_by ?? d.dueBy ?? d.respond_by ?? b.due_by ?? null;

  /* itemId — Commas product / checkout session id (e.g. "8YZPo"). Stored on
     payment_links.commas_session_id at mint so we can settle the row when
     api_metadata.link_ref is missing or mismatched. */
  const itemId =
    (d.item && (d.item.id || d.item.product_id)) ||
    d.product_id ||
    (d.product && d.product.id) ||
    d.checkout_session_id ||
    null;

  return {
    id: id ? String(id) : null,
    paymentId: paymentIdOf(body),
    type,
    name: String(name),
    amount,
    email: String(email).trim().toLowerCase(),
    ref: ref ? String(ref) : null,
    itemId: itemId ? String(itemId) : null,
    dueBy: dueByRaw ? String(dueByRaw) : null
  };
}

/* buildCommasCheckoutUrl — a checkout link for a VARIABLE amount, for the CRM's
   "send a payment link" action (src/payment-links/index.mjs). Pure URL
   construction, no network call: this repo permits new outbound `fetch` only
   inside src/messaging/providers/* (CLAUDE.md §12), and a Commas API endpoint
   to mint a server-side checkout SESSION is not confirmed to exist — see
   docs/PAYMENT-LINKS-SPEC.md. What IS confirmed is that Commas checkout pages
   are reached by URL, so this assumes (⚠️ CONFIRM against a live Commas
   account, same as the rest of this file) that the page reads `amount`,
   `description` and a caller-supplied reference off the query string the way
   the live handler's product pages do. `ref` is the value normalizeCommasEvent
   above looks for on the way back in — round-tripping it is what lets the
   webhook find this link again. */
export function buildCommasCheckoutUrl({ baseUrl, linkRef, amountCents, description }) {
  if (!baseUrl) throw new TypeError("buildCommasCheckoutUrl: baseUrl is required (COMMAS_CHECKOUT_BASE_URL)");
  if (!linkRef) throw new TypeError("buildCommasCheckoutUrl: linkRef is required");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`buildCommasCheckoutUrl: amountCents must be a positive integer, got ${amountCents}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set("amount", (amountCents / 100).toFixed(2));
  url.searchParams.set("ref", linkRef);
  if (description) url.searchParams.set("description", description);
  return url.toString();
}

function nameMatches(name, needle) {
  return String(name || "").toLowerCase().includes(needle);
}

// Product bucket from a normalized event: "crs" | "deposit" | "success_fee" | "diy" | "unmatched".
export function productOf(evt) {
  if (nameMatches(evt.name, PRODUCT.CRS.nameIncludes)) return "crs";
  if (nameMatches(evt.name, PRODUCT.DIY.nameIncludes)) return "diy";
  if (nameMatches(evt.name, PRODUCT.DEPOSIT.nameIncludes)) return "deposit";
  if (nameMatches(evt.name, PRODUCT.SUCCESS_FEE.nameIncludes)) return "success_fee";
  return "unmatched";
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Every successful payment emits `payment.received` (the money-in fact). The
// product then adds a SEMANTIC event the journey reacts to. A failed payment
// emits only `payment.failed`. Unknown/non-terminal events map to nothing.
export function mapToCanonical(evt) {
  const out = [];
  if (!evt || !evt.type) return out;
  const t = evt.type;

  /* ORDER MATTERS HERE, and the ordering is not cosmetic.
     "payment.canceled" contains "cancel"; a refund or dispute type can contain
     other words we match on. The specific outcomes are therefore tested before
     the generic failed/succeeded pair, so a refund can never fall through into
     "succeeded" and credit the money a second time. */

  /* expired / canceled — ABANDONED CHECKOUTS, NOT DECLINES.
     A link that timed out, or a customer who backed out before paying. No
     money moved, so there is no money event and deliberately no
     payment.failed: folding these into the decline path would inflate the
     decline rate with people who were never declined, and decline rate is a
     number the sales floor is managed on. These exist for visibility only. */
  if (t.includes("expired")) {
    out.push({ name: "payment.expired", product: productOf(evt) });
    return out;
  }
  if (t.includes("cancel")) {
    out.push({ name: "payment.canceled", product: productOf(evt) });
    return out;
  }

  /* refund / dispute — money that already moved is now in question.
     NEITHER reverses the ledger here. How a refund should be treated in
     commission accounting, and how a chargeback should, are two different
     questions with two different answers, and neither has been decided. An
     adapter inventing one would silently rewrite somebody's pay. The events
     are emitted; a dispute additionally drives an urgent task, because it has
     a deadline (src/handlers/commas-disputes.mjs). */
  if (t.includes("refund")) {
    out.push({ name: "payment.refunded", product: productOf(evt) });
    return out;
  }
  if (t.includes("dispute") || t.includes("chargeback")) {
    out.push({ name: "payment.disputed", product: productOf(evt) });
    return out;
  }

  if (t.includes("failed")) {
    out.push({ name: "payment.failed", product: null });
    return out;
  }
  if (!t.includes("succeeded")) return out; // pending/other — ignore

  // Money-in fact, always.
  out.push({ name: "payment.received", product: productOf(evt) });

  // Semantic journey event per product.
  const product = productOf(evt);
  if (product === "crs") out.push({ name: "diagnostic.paid", product }); // $32 soft-pull gate
  else if (product === "deposit") out.push({ name: "deposit.paid", product }); // onboarding deposit
  else if (product === "diy") out.push({ name: "sale.closed", product }); // DIY letters downsell purchase
  // success_fee + unmatched: payment.received only (handlers can inspect payload.product).

  return out;
}

// --- Adapter entrypoint: ACK FIRST, WORK LATER ------------------------------
/* handleCommasWebhook({ db, rawBody, signatureHeader, secret })
 *   → { ok, status, queued, deduped, inboxId, reason? }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED, AND WHY IT HAD TO.
 *
 * This function used to verify, normalise, emit every canonical event and run
 * the entire money chain — client creation, commission accrual, entitlements,
 * closeout — all before returning a status code. That is safe with a provider
 * that retries. Commas does not retry. It delivers AT MOST ONCE, and a
 * delivery that fails is logged on their side and dropped, with no way for us
 * to learn it happened.
 *
 * So under the old shape, any failure anywhere in that chain lost a real
 * payment permanently. A deposit would simply never register, and nothing in
 * the system would be able to say a payment had ever arrived.
 *
 * Now it does the smallest durable thing available: verify the signature,
 * write the exact bytes to commas_inbox, answer 200. One INSERT. Everything
 * else — parsing, mapping, emitting, the money chain — is done afterwards by
 * netlify/functions/commas-inbox-sweeper.mjs, and all of it is retryable
 * because the bytes are already safe.
 *
 * IT NO LONGER RETURNS `emitted`. Callers cannot learn from the response what
 * events a payment produced, because at the moment of responding nothing has
 * been decided yet. That is the trade the at-most-once guarantee costs, and it
 * is the right way round: a caller that wanted the answer synchronously was a
 * caller holding a payment hostage to the money chain succeeding on the first
 * try.
 *
 * A MALFORMED BODY IS STILL STORED. It is verified — it carries a valid
 * signature, so it genuinely came from Commas — and a payload we could not
 * parse but kept is a bug report, while one we refused is a lost payment.
 * Only an unsigned request is refused. */
export async function handleCommasWebhook({ db, rawBody, signatureHeader, secret, headers = {} }) {
  if (!verifyCommasSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", queued: false };
  }

  /* Parse only far enough to key the row. A body that will not parse still
     gets stored, under a hash of its own bytes — see dedupeKeyFor. */
  let body = null;
  let parseError = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    parseError = String(err?.message || err).slice(0, 200);
  }

  const eventType = body ? eventTypeOf(body) : null;
  const paymentId = body ? paymentIdOf(body) : null;

  try {
    const orgId = await defaultOrgId(db);
    const res = await enqueue(db, {
      orgId,
      rawBody: rawBody ?? "",
      headers,
      paymentId,
      eventType,
      source: "webhook"
    });
    return {
      ok: true,
      status: 200,
      queued: !res.deduped,
      deduped: res.deduped,
      inboxId: res.id,
      paymentId,
      eventType,
      reason: parseError ? `stored_unparseable:${parseError}` : null
    };
  } catch (err) {
    /* The queue write itself failed. This is the one case the caller must hear
       about as a failure: nothing durable happened, so answering 200 would
       tell Commas the payment was safely received when it was not. They will
       not retry either way, but a 5xx is at least visible in their delivery
       log and in ours. */
    console.error(
      `[commas] INBOX WRITE FAILED — payment ${paymentId || "?"} ` +
      `(${eventType || "?"}) may be lost: ${String(err?.message || err).slice(0, 300)}`
    );
    return {
      ok: false,
      status: 500,
      reason: "inbox_write_failed",
      queued: false,
      paymentId,
      eventType
    };
  }
}

/* processCommasInboxRow(row, db) → { ok, ignored?, reason?, emitted }
 *
 * Phase two. Runs from the sweeper, never from the request path. Interprets
 * one stored row and puts its canonical events on the bus.
 *
 * IDEMPOTENCY IS THE ROW'S DEDUPE KEY, not a fresh guess. `row.dedupe_key` is
 * already anchored to data.payment_id, so re-running a row — which happens
 * whenever a pass is retried — writes no second event and dispatches no second
 * handler.
 *
 * HANDLER FAILURES DO NOT FAIL THE ROW, deliberately. emit() catches each
 * handler and records it to the dead-letter queue, which owns the retry. If
 * this function threw on a handler error instead, the row would be marked
 * failed and retried, and every retry would dedupe on the idempotency key and
 * dispatch nothing — retrying forever while achieving nothing, and masking the
 * dead-letter entry that actually describes the problem. What DOES fail a row
 * is failing to write the event at all. */
export async function processCommasInboxRow(row, db) {
  let body;
  try {
    body = JSON.parse(row.raw_body || "{}");
  } catch (err) {
    /* Terminal, not retryable — the bytes will not start parsing on the next
       pass. Marked ignored so it stops consuming attempts, with the reason on
       the row. The raw body is retained for whoever looks. */
    return { ok: true, ignored: true, reason: `unparseable_json: ${String(err?.message || err).slice(0, 200)}`, emitted: [] };
  }

  const evt = normalizeCommasEvent(body);
  const canonical = mapToCanonical(evt);
  if (canonical.length === 0) {
    return { ok: true, ignored: true, reason: `no_canonical_mapping:${evt.type || "unknown"}`, emitted: [] };
  }

  const emitted = [];
  for (const c of canonical) {
    const payload = {
      product: c.product,
      productName: evt.name,
      amount: evt.amount,
      email: evt.email,
      /* providerRef prefers the payment id over the envelope id. Downstream
         money handlers use this as the provider's stable reference for a
         payment; the envelope id changes per delivery and never should have
         been it. Falls back to the old value when no payment id is present, so
         existing rows and older payloads behave exactly as before. */
      providerRef: evt.paymentId || evt.id,
      paymentId: evt.paymentId,
      ref: evt.ref, // our own reference, if the payment came from a payment_links checkout URL
      itemId: evt.itemId,
      dueBy: evt.dueBy, // dispute response deadline, when the event carries one
      source: "commas"
    };
    const res = await emit(db, c.name, payload, {
      orgId: row.org_id,
      idempotencyKey: `commas:${row.dedupe_key}:${c.name}`
    });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, emitted };
}
