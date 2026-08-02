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
import { emit } from "../events/bus.mjs";

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
    d.product_name ||
    (d.product && (d.product.name || d.product.title)) ||
    li.name ||
    li.product_name ||
    (li.price && li.price.product && li.price.product.name) ||
    d.name ||
    b.product_name ||
    "";

  const email =
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
    d.client_reference_id ||
    (d.metadata && (d.metadata.link_ref || d.metadata.ref)) ||
    d.reference ||
    d.ref ||
    b.client_reference_id ||
    b.ref ||
    null;

  return {
    id: id ? String(id) : null,
    type,
    name: String(name),
    amount,
    email: String(email).trim().toLowerCase(),
    ref: ref ? String(ref) : null
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

  if (evt.type.includes("failed")) {
    out.push({ name: "payment.failed", product: null });
    return out;
  }
  if (!evt.type.includes("succeeded")) return out; // pending/other — ignore

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

// --- Adapter entrypoint -----------------------------------------------------
// handleCommasWebhook({ db, rawBody, signatureHeader, secret })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Verifies, parses, maps, and emits each canonical event on the bus. Idempotency
// key = commas:<eventId>:<canonicalName> so a re-delivered webhook is a safe no-op
// while the two distinct events from one payment each get their own key. `db` is
// injected (pg pool or a fake) so this is unit-testable without Postgres.
export async function handleCommasWebhook({ db, rawBody, signatureHeader, secret }) {
  if (!verifyCommasSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
  }

  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }

  const evt = normalizeCommasEvent(body);
  const canonical = mapToCanonical(evt);
  if (canonical.length === 0) {
    return { ok: true, status: 200, reason: `ignored:${evt.type || "unknown"}`, emitted: [] };
  }

  const emitted = [];
  for (const c of canonical) {
    const payload = {
      product: c.product,
      productName: evt.name,
      amount: evt.amount,
      email: evt.email,
      providerRef: evt.id, // Commas txn id — lets the payment handler dedup on replay
      ref: evt.ref, // our own reference, if the payment came from a payment_links checkout URL
      source: "commas"
    };
    /* An event with no provider id used to get NO idempotency key at all, so a
       redelivered webhook emitted a second payment.received and the money was
       counted twice in transactions. evt.id already has four fallbacks and can
       still come back null, and "the provider always sends one" is not a
       property this code can rely on for money.

       Falling back to a hash of the exact bytes: a webhook RETRY is by
       definition byte-identical, so it dedupes, and no semantic guess is made
       about which fields identify a payment. Two genuinely distinct payments
       would have to be byte-identical to collide — same amount, same email,
       same product, and no id or timestamp anywhere in the body — which is a
       payload that could not be deduplicated by any means. */
    const idKey = evt.id
      ? `commas:${evt.id}:${c.name}`
      : `commas:body:${crypto.createHash("sha256").update(rawBody || "").digest("hex")}:${c.name}`;
    const res = await emit(db, c.name, payload, { idempotencyKey: idKey });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, status: 200, emitted };
}
