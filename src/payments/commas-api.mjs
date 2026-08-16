/* Commas read API — the recovery path for payments no webhook ever brought us.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY OUTBOUND `fetch` LIVES HERE AND NOT IN src/messaging/providers/.
 *
 * CLAUDE.md §12 says new outbound `fetch` belongs in src/messaging/providers/*
 * and nowhere else. That rule is about outbound TRANSMISSION — code that sends
 * a message to a human being. This is a read-only GET against a payments API
 * on a schedule, and the repo already has that exact shape in
 * src/adapters/hubstaff.mjs (`hubstaffGet`, driven by
 * netlify/functions/hubstaff-poll-sweeper.mjs). Filing a payments poller under
 * "messaging providers" would put it in the registry's directory, next to the
 * modules index.mjs validates as senders, which is a worse outcome than the
 * one the rule is protecting against.
 *
 * Flagged rather than assumed. If the owner wants the rule read literally,
 * this file moves and nothing else changes: it is one exported function with
 * an injected fetch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * *** WHAT THIS CANNOT DO. READ BEFORE RELYING ON IT. ***
 *
 * The documented endpoint is GET /payments/:id. That takes a payment id and
 * returns that payment. It CANNOT answer "which payments happened that I never
 * heard about", because answering that needs a LIST endpoint, and no list
 * endpoint has been confirmed to exist.
 *
 * So this closes part of the at-most-once gap, not all of it:
 *
 *   COVERED — a payment whose webhook we RECEIVED but failed to process. The
 *   bytes are already in commas_inbox and the sweeper retries them. This file
 *   is not even needed for that case.
 *
 *   COVERED — a payment somebody spots in the Commas dashboard that is missing
 *   from Fundhub. Hand its id to reconcilePayment() and it enters the same
 *   pipeline as a pushed webhook, marked source='reconcile'.
 *
 *   NOT COVERED — a payment whose webhook delivery failed on the Commas side.
 *   Commas logs it and drops it. We are never told, we never learn the payment
 *   id, and with only GET /payments/:id there is no way to go looking. That
 *   money is invisible until a human notices.
 *
 * Closing the last one needs one of: a list/search endpoint from Commas, a
 * webhook delivery-log export, or a daily payout reconciliation against their
 * statement. That is a question for Commas, not something this repo can
 * invent its way around.
 */

/* Base URL. ⚠️ NOT CONFIRMED against live Commas documentation — same caveat
   as every other Commas field path in this repo. Overridable so it can be
   corrected with an env var rather than a deploy of new code. */
export const DEFAULT_API_BASE = "https://api.commas.io";

export const API_KEY_ENV = "COMMAS_API_KEY";
export const API_BASE_ENV = "COMMAS_API_BASE";

/* commasConfig — FAILS CLOSED. No key means `ok: false`, and every caller
   returns rather than guessing. An unconfigured reconciliation path that
   quietly reports "nothing to reconcile" is worse than one that says it is
   switched off, because the first looks like a clean bill of health. */
export function commasConfig(env = process.env) {
  const apiKey = env[API_KEY_ENV];
  if (!apiKey) {
    return {
      ok: false,
      reason: `${API_KEY_ENV} is not set — the Commas read API is unreachable, ` +
        `so no payment can be reconciled`
    };
  }
  return {
    ok: true,
    apiKey,
    base: String(env[API_BASE_ENV] || DEFAULT_API_BASE).replace(/\/+$/, "")
  };
}

/* getPayment(cfg, paymentId, { fetchImpl }) → { ok, status, payment?, reason? }
 *
 * NEVER THROWS on a transport or HTTP error. A reconciliation pass runs on a
 * schedule against an API we do not control; one 500 from them must not take
 * the pass down, because the next pass is the retry.
 *
 * A 404 is reported as `ok: false, status: 404` and is meaningful: it means
 * the id is not a payment they know about, which is a data problem worth
 * seeing rather than a transient failure worth retrying. */
export async function getPayment(cfg, paymentId, { fetchImpl = fetch } = {}) {
  if (!cfg?.ok) return { ok: false, status: 0, reason: cfg?.reason || "not_configured" };
  if (!paymentId) return { ok: false, status: 0, reason: "payment_id_required" };

  const url = `${cfg.base}/payments/${encodeURIComponent(String(paymentId))}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: "application/json"
      }
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: `commas_api_${res.status}`,
        body: text.slice(0, 300)
      };
    }
    let payment;
    try {
      payment = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, reason: "commas_api_invalid_json", body: text.slice(0, 300) };
    }
    return { ok: true, status: res.status, payment, raw: text };
  } catch (err) {
    return { ok: false, status: 0, reason: `commas_api_unreachable: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/* reconcilePayment(db, { paymentId, env, fetchImpl }) → { ok, enqueued, ... }
 *
 * Pull one payment by id and put it into the SAME inbox a webhook writes to,
 * marked source='reconcile'. One processing path, one set of bugs: a
 * reconciled payment is normalised, mapped and emitted by exactly the code
 * that handles a pushed one.
 *
 * IDEMPOTENT AGAINST THE PUSH PATH. The inbox dedupe key is anchored on
 * data.payment_id, so reconciling a payment whose webhook DID arrive collides
 * with the existing row and does nothing. Reconciling is therefore always safe
 * to run, including on a payment nobody is sure about — which is the whole
 * point of having it.
 *
 * SYNTHESISES THE ENVELOPE. GET /payments/:id returns a payment, not a webhook
 * event, so there is no `type` on it. We wrap it as
 * { type, data: <payment>, source: "reconcile" } before storing, so the
 * normaliser sees the shape it expects. The type defaults to
 * "payment.succeeded" because a payment that exists and is being reconciled is
 * one that happened — but if the payload carries its own status, that wins. */
export async function reconcilePayment(db, {
  paymentId,
  orgId,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const cfg = commasConfig(env);
  if (!cfg.ok) return { ok: false, enqueued: false, reason: cfg.reason };

  const got = await getPayment(cfg, paymentId, { fetchImpl });
  if (!got.ok) return { ok: false, enqueued: false, reason: got.reason, status: got.status };

  const payment = got.payment || {};
  const status = String(payment.status || payment.state || "").toLowerCase();
  const type = status ? `payment.${status}` : "payment.succeeded";

  const envelope = JSON.stringify({
    type,
    data: payment,
    reconciled_at: new Date().toISOString()
  });

  const { enqueue } = await import("./commas-inbox.mjs");
  const { defaultOrgId } = await import("../events/bus.mjs");
  const org = orgId || (await defaultOrgId(db));

  const res = await enqueue(db, {
    orgId: org,
    rawBody: envelope,
    headers: {},
    paymentId: String(paymentId),
    eventType: type,
    source: "reconcile"
  });

  return {
    ok: true,
    enqueued: !res.deduped,
    alreadyKnown: res.deduped,
    inboxId: res.id,
    type
  };
}

/* ── Checkout sessions (mint a client pay link) ─────────────────────────────
 *
 * Auth is `x-api-key` against www.fanbasis.com/public-api — NOT the Bearer
 * reconcile client above (different product surface, different key).
 * Spec: https://apidocs.fan / https://commasdocs.com
 *
 * Env: FANBASIS_CHECKOUT_API_KEY (preferred). Never invent a URL-query link
 * when this key is present — Commas returns payment_link on the response. */

export const CHECKOUT_API_KEY_ENV = "FANBASIS_CHECKOUT_API_KEY";
export const DEFAULT_CHECKOUT_API_BASE = "https://www.fanbasis.com/public-api";
export const CHECKOUT_API_BASE_ENV = "FANBASIS_CHECKOUT_API_BASE";

export function checkoutConfig(env = process.env) {
  const apiKey = String(env?.[CHECKOUT_API_KEY_ENV] || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: `${CHECKOUT_API_KEY_ENV} is not set — cannot mint a Commas checkout session`
    };
  }
  return {
    ok: true,
    apiKey,
    base: String(env?.[CHECKOUT_API_BASE_ENV] || DEFAULT_CHECKOUT_API_BASE).replace(/\/+$/, "")
  };
}

/**
 * createCheckoutSession — POST /checkout-sessions → { payment_link }.
 * Never throws on HTTP/transport failure; callers decide how to surface it.
 */
export async function createCheckoutSession({
  amountCents,
  productTitle,
  productDescription = null,
  type = "onetime_non_reusable",
  metadata = null,
  successUrl = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const cfg = checkoutConfig(env);
  if (!cfg.ok) return { ok: false, reason: cfg.reason };

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "amount_cents must be a positive integer" };
  }
  const title = String(productTitle || "").trim();
  if (!title) return { ok: false, reason: "product title is required" };

  const body = {
    amount_cents: amountCents,
    product: { title },
    type
  };
  if (productDescription) body.product.description = String(productDescription);
  const success = successUrl
    || env.COMMAS_SUCCESS_URL
    || env.PUBLIC_BASE_URL && `${String(env.PUBLIC_BASE_URL).replace(/\/$/, "")}/app/payment-success.html`
    || "https://fundhub.ai/app/payment-success.html";
  if (success) body.success_url = String(success);
  if (metadata && typeof metadata === "object") {
    const meta = {};
    for (const [k, v] of Object.entries(metadata)) {
      if (v == null) continue;
      meta[k] = String(v);
    }
    body.metadata = meta;
  }

  try {
    const res = await fetchImpl(`${cfg.base}/checkout-sessions`, {
      method: "POST",
      headers: {
        "x-api-key": cfg.apiKey,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, reason: "checkout_invalid_json", body: text.slice(0, 300) };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: json.message || json.error || `checkout_http_${res.status}`,
        body: text.slice(0, 300)
      };
    }
    const data = json.data || {};
    const paymentLink = data.payment_link;
    if (!paymentLink) {
      return { ok: false, status: res.status, reason: "checkout_missing_payment_link", body: text.slice(0, 300) };
    }
    return {
      ok: true,
      status: res.status,
      paymentLink: String(paymentLink),
      checkoutSessionId: data.checkout_session_id ?? data.id ?? null,
      productId: data.id ?? null,
      raw: json
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      reason: `checkout_unreachable: ${String(err?.message || err).slice(0, 200)}`
    };
  }
}
