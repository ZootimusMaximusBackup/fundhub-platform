// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — payment rail. This module mints
// a HOSTED CHECKOUT LINK for a paid service request. It is the only place in
// this lane that talks to a processor.
//
// ═══════════════════════════════════════════════════════════════════════════
// NO SILENT CARD CAPTURE. OWNER-SET, AND ALREADY TRUE IN THIS REPOSITORY.
//
// Nothing here can charge a stored token, and this file does not add a way to.
// src/subscriptions/charger.mjs:25 ships an EMPTY charger map and :88 puts a
// second env lock behind it, so there is no code path from "we have a token"
// to "money moved". A hosted link is the rail that works today
// (src/payments/commas-api.mjs createCheckoutSession → { payment_link }): the
// client opens a page at the processor, the processor takes the card, and we
// find out through a webhook.
//
// The practical consequence, stated plainly because a screen depends on it: a
// minted link is NOT a payment. It is an invitation. `awaiting_payment` means
// the invitation is out and nothing has been charged.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW THE PAYMENT FINDS ITS WAY BACK
//
// The session is minted with metadata { link_ref, client_id, org_id }.
// `link_ref` is the paid_service_requests row id, and src/adapters/commas.mjs
// reads that bag back out on the way in (`ref`, :237-246) — so the webhook
// event carries the id of the request it paid for. That is a round trip the
// repository already relies on for payment_links, reused rather than
// reinvented, and it is why nothing here has to guess from the amount.
//
// ⚠️ Same CONFIRM caveat the rest of the Commas integration carries: the exact
// key Commas echoes metadata back under has not been observed against a live
// payload. If that round trip is wrong for payment_links it is wrong here too,
// and it is wrong in one place.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PRODUCT TITLE IS DELIBERATELY BLAND
//
// src/payments/commas-safe-copy.mjs is an owner-set HARDEST RULE: no outbound
// Commas copy may contain credit or funding language. "credit", "bureau",
// "repair", "fee", "capital", "score" and "inquiry" are all on that ban list,
// which rules out every obvious title for this product. So the title says
// "Document round N" and nothing else, and checkoutTitleFor() is asserted
// against the guard by its own test rather than by anybody remembering.

import { createCheckoutSession, checkoutConfig } from "../payments/commas-api.mjs";
import { assertCommasSafeCopy } from "../payments/commas-safe-copy.mjs";

/** The processor-facing name of a self-serve round. Bland on purpose — see the
 *  header. `roundNo` is the self-serve counter, not the program's cap. */
export function checkoutTitleFor(roundNo) {
  const n = Number.isInteger(roundNo) && roundNo > 0 ? roundNo : null;
  const title = n ? `Document round ${n}` : "Document round";
  // Fail closed rather than let a future edit ship banned copy to a processor.
  assertCommasSafeCopy(title, { field: "product.title" });
  return title;
}

/**
 * mintCheckoutLink — an invitation to pay, for one paid_service_requests row.
 *
 * Returns `{ ok: true, checkoutUrl, sessionId }` or `{ ok: false, reason }`.
 * NEVER THROWS on a processor failure: the caller has a database row to mark
 * `failed` and a client to answer, and an exception thrown from inside the
 * mint is a row left at `quoted` with nobody able to say why.
 *
 * @param {{requestId:string, clientId:string, orgId:string, amountCents:number,
 *          roundNo?:number|null, env?:object, fetchImpl?:Function}} opts
 */
export async function mintCheckoutLink({
  requestId,
  clientId,
  orgId,
  amountCents,
  roundNo = null,
  env = process.env,
  fetchImpl = fetch
} = {}) {
  if (!requestId) return { ok: false, reason: "request_id_required" };
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    // Money is integer cents (CLAUDE.md §12). A non-integer here means the
    // receipt was built wrong upstream, and sending it would charge the wrong
    // amount rather than fail.
    return { ok: false, reason: "amount_cents must be a positive integer" };
  }

  /* Fails closed with a NAMED reason when the checkout key is absent, the same
     posture commasConfig() takes. A scratch database and a laptop have no key,
     so this is the branch most tests see — and it must be distinguishable from
     "the processor said no", because one is a configuration gap and the other
     is a decline. */
  const cfg = checkoutConfig(env);
  if (!cfg.ok) return { ok: false, reason: cfg.reason || "checkout_not_configured" };

  let title;
  try {
    title = checkoutTitleFor(roundNo);
  } catch (err) {
    return { ok: false, reason: err?.code || "commas_unsafe_copy" };
  }

  const minted = await createCheckoutSession({
    amountCents,
    productTitle: title,
    type: "onetime_non_reusable",
    metadata: {
      // The round trip. See the header.
      link_ref: requestId,
      client_id: clientId,
      org_id: orgId
    },
    env,
    fetchImpl
  });

  if (!minted.ok) {
    return { ok: false, reason: minted.reason || "checkout_failed", status: minted.status || 502 };
  }
  return {
    ok: true,
    checkoutUrl: minted.paymentLink,
    sessionId: minted.checkoutSessionId || null
  };
}
