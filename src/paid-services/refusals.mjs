// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing. This module carries
// the words a client reads when a paid request is refused, including the two
// refusals that happen after money has been asked for.
//
// WHY REFUSALS GET THEIR OWN FILE
//
// A refusal is the part of a paid feature most likely to be written twice and
// worded differently each time: once in the endpoint, once in the handler that
// runs after payment. Two wordings for one situation is how a client is told
// "we could not start this" on the screen and "your round is under way" in an
// email. So there is one table, every caller quotes it, and a test asserts the
// set.
//
// EVERY MESSAGE IS CLIENT-SAFE. These strings are returned to a client
// principal, so:
//   * No stack traces, no processor error bodies, no internal ids.
//   * Owner-set branding: the words "credit repair" appear nowhere. This is
//     funding-optimisation and capital-readiness language. The dispute letters
//     themselves, their FCRA wording, the repair_* tables and the internal
//     staff screens are NOT renamed — that scope boundary is in the plan.
//
// NULL MEANS UNKNOWN (CLAUDE.md §12). There is deliberately no refusal for
// "we have never pulled this file". A client we know nothing about is not a
// client we have grounds to turn away; NOTHING_TO_DISPUTE fires only on a pull
// we have actually read.

/** Machine-readable refusal codes. The code is the stable part; the sentence
 *  beside it is not, and no caller should branch on the sentence. */
export const REFUSAL = Object.freeze({
  /** The client is not on an offer path where this work applies. */
  NOT_ON_OFFER_PATH: "not_on_offer_path",
  /** A request of this kind is already open for this client. */
  ALREADY_IN_FLIGHT: "already_in_flight",
  /** We read their newest report and found nothing that can be challenged. */
  NOTHING_TO_DISPUTE: "nothing_to_dispute",
  /** The checkout link could not be minted, or the processor declined. */
  PAYMENT_FAILED: "payment_failed",
  /** Money arrived, but less than the round was quoted at. Nothing is staged.
   *  Fires only when the processor states an amount AND the row carries a
   *  price to compare it against; an unknown amount is still unknown and
   *  falls back to the quote (see recordPayment). */
  PAYMENT_SHORT: "payment_short",
  /** Paid, but the fresh report could not be ordered. */
  PULL_FAILED: "pull_failed"
});

export const REFUSAL_CODES = Object.freeze(Object.values(REFUSAL));

/** HTTP status for each refusal. A refusal is not a bug, so none of these is a
 *  500: the caller asked for something we will not do, and the reason is
 *  reportable. PAYMENT_FAILED is 502 because the thing that failed is the
 *  processor, not the request. */
const STATUS = Object.freeze({
  [REFUSAL.NOT_ON_OFFER_PATH]: 403,
  [REFUSAL.ALREADY_IN_FLIGHT]: 409,
  [REFUSAL.NOTHING_TO_DISPUTE]: 409,
  [REFUSAL.PAYMENT_FAILED]: 502,
  [REFUSAL.PAYMENT_SHORT]: 409,
  [REFUSAL.PULL_FAILED]: 502
});

const MESSAGE = Object.freeze({
  [REFUSAL.NOT_ON_OFFER_PATH]:
    "This is part of the funding-optimisation plan, and that plan is not on your file yet. "
    + "Your advisor can add it.",
  [REFUSAL.ALREADY_IN_FLIGHT]:
    "You already have a round in progress. We will not start a second one or charge you twice — "
    + "the one you have is on the page.",
  [REFUSAL.NOTHING_TO_DISPUTE]:
    "Your newest report has nothing left for us to challenge, so there is nothing to buy. "
    + "If something new appears, this opens again.",
  [REFUSAL.PAYMENT_FAILED]:
    "We could not open the payment page just now. Nothing has been charged. Please try again.",
  [REFUSAL.PAYMENT_SHORT]:
    "The payment we received was less than the amount for this round, so we have not started it. "
    + "Your advisor has been given this to sort out. Nothing further has been charged.",
  [REFUSAL.PULL_FAILED]:
    "Your payment went through, but we could not order a fresh copy of your report. "
    + "Your advisor has been given this to sort out and you will not be charged again."
});

/** The sentence a client reads for a refusal code. Unknown code → a generic
 *  sentence rather than `undefined`, because a blank refusal on a screen reads
 *  as a broken button. */
export function refusalMessage(code) {
  return MESSAGE[code]
    || "We could not start this right now. Nothing has been charged.";
}

/** HTTP status for a refusal code. Unknown → 409, never 500: an unrecognised
 *  refusal is still a refusal and not a crash. */
export function refusalStatus(code) {
  return STATUS[code] || 409;
}

/** The shape every refusing function returns and every caller reads. */
export function refuse(code, detail = null) {
  return {
    ok: false,
    reason: code,
    message: refusalMessage(code),
    status: refusalStatus(code),
    detail: detail == null ? null : String(detail).slice(0, 300)
  };
}

/* Owner-set branding guardrail, enforced here rather than in a review comment:
   the banned phrase cannot reach a client through this module without a test
   failing. Exported so the endpoint's own literals can be checked by the same
   rule. */
export const BANNED_CLIENT_PHRASES = Object.freeze(["credit repair"]);

export function violatesClientCopyRules(text) {
  const s = String(text == null ? "" : text).toLowerCase();
  return BANNED_CLIENT_PHRASES.filter((p) => s.includes(p));
}
