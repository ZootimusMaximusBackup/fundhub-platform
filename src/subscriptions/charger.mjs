// The processor seam for recurring charges — and it is empty on purpose.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT COMMAS CAN ACTUALLY DO. THIS IS THE FINDING, NOT A PLACEHOLDER.
//
// The entire confirmed outbound surface for this processor, read off the two
// modules that own it:
//
//   src/payments/commas-api.mjs
//     getPayment()            GET  /payments/:id        — read one payment
//     createCheckoutSession() POST /checkout-sessions    — mint a payment LINK
//                             the only `type` ever sent is
//                             "onetime_non_reusable"
//   src/adapters/commas.mjs
//     buildCommasCheckoutUrl() — builds a hosted checkout URL by hand
//     handleCommasWebhook()    — parses what they push at us
//
// Every one of those either READS or asks a HUMAN TO CLICK SOMETHING. There is
// no create-subscription call, no cancel-subscription call, and above all no
// merchant-initiated "charge the token you already hold" call. The adapter
// parses subscription-shaped inbound events, but being able to read an event
// they might send is not the same as being able to ask them for money.
// `client_cards` has stored a processor token since migration 076 and nothing
// in this repository has ever charged one.
//
// SO: COMMAS EXPOSES NO SUBSCRIPTION PRIMITIVE WE CAN BUILD ON, and the honest
// design is our own scheduler creating one charge per cycle against a stored
// instrument. Everything else in this slice — 276's ledger, billing.mjs,
// billing-store.mjs, the sweeper — is that scheduler, and it is complete.
//
// This file is the one piece that cannot be written from what the repo knows.
// Guessing `POST /charges` because a payments API probably has one is how money
// moves in a way nobody can explain afterwards, and CLAUDE.md §2 is explicit:
// never invent, the absence IS the finding. So the registry below ships EMPTY,
// resolveCharger() refuses, and the sweeper's honest report is "N due, N
// skipped, no charger configured" rather than a number that looks like work.
//
// WHAT UNBLOCKS IT: one confirmed endpoint from Commas that charges a stored
// token, or a second processor. Then registerCharger("commas", fn) here, with
// the fetch itself living in a provider module — src/messaging/providers/* is
// the only sanctioned home for new outbound transmission (CLAUDE.md §12), and
// the three exceptions listed there are named as exceptions, not precedent.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO LOCKS, NOT ONE.
//
// An empty registry already means nothing can charge. The env flag is a second
// lock in front of it so that the day a charger IS registered, registering it
// is not the same act as switching live billing on for every scheduled row. The
// same reasoning message-dispatch-sweeper.mjs records for the outbound switch:
// the gate moves, it does not disappear.

/** Must be exactly "true" for a charge to be attempted. Absent, empty, "1",
    "yes" and "TRUE" all mean off — a flag that guesses is a flag that gets
    turned on by accident. */
export const BILLING_ENABLED_ENV = "SUBSCRIPTION_BILLING_ENABLED";

/** provider name → charge function. EMPTY, and see the header for why. */
const CHARGERS = new Map();

/**
 * A charge function is `async ({ ... }) => ({ ok, providerRef?, code?, reason?, retryable? })`
 * and MUST NOT THROW — a throw from inside a processor call is the ambiguous
 * case (did the money move?) that costs the most to unpick. classifyChargeResult
 * in billing.mjs reads the shape; `retryable: false` is the only way to say
 * "declined", and anything else is treated as our fault.
 *
 * Returns a disposer so a test can register a fake without leaking it into the
 * next test file in the same process.
 */
export function registerCharger(provider, fn) {
  const key = String(provider || "").trim().toLowerCase();
  if (!key) throw new TypeError("registerCharger: provider is required");
  if (typeof fn !== "function") throw new TypeError("registerCharger: fn must be a function");
  const previous = CHARGERS.get(key);
  CHARGERS.set(key, fn);
  return () => {
    if (previous) CHARGERS.set(key, previous);
    else CHARGERS.delete(key);
  };
}

/** Which providers can charge. Empty in a shipped build. */
export function registeredChargers() {
  return [...CHARGERS.keys()].sort();
}

/**
 * resolveCharger — the charge function for a provider, or a named refusal.
 *
 * FAILS CLOSED, in the same shape commasConfig() uses in
 * src/payments/commas-api.mjs: `{ ok: false, reason }`. An unconfigured billing
 * rail that quietly reports "nothing to charge" is worse than one that says it
 * is switched off, because the first looks like a clean bill of health.
 */
export function resolveCharger({ provider = "commas", env = process.env } = {}) {
  const key = String(provider || "").trim().toLowerCase() || "commas";

  if (String(env?.[BILLING_ENABLED_ENV] ?? "").trim() !== "true") {
    return {
      ok: false,
      code: "billing_disabled",
      reason: `${BILLING_ENABLED_ENV} is not "true" — recurring billing is switched off, so no card is charged`
    };
  }

  const fn = CHARGERS.get(key);
  if (!fn) {
    return {
      ok: false,
      code: "no_charger",
      reason: `no charge function is registered for "${key}" — this processor exposes no confirmed `
        + `merchant-initiated charge endpoint, so nothing can be charged on a cycle yet`
    };
  }
  return { ok: true, charge: fn, provider: key };
}

/**
 * instrumentRefusal — why this subscription has nothing to charge against, or
 * null if it has one.
 *
 * A PARTNER ALWAYS LANDS HERE, TODAY, AND THAT IS CORRECT. 271 added
 * `subscriptions_partner_card_chk` (partner_id IS NULL OR card_id IS NULL)
 * because there is no partner instrument table in this repository — 271's own
 * header says so. So a partner subscription structurally cannot carry a card,
 * and this returns "no_partner_instrument" for every one of them.
 *
 * IT IS A SKIP, NEVER A FAILURE. A missing table on our side is not a customer
 * declining a payment: burning a retry and flipping a partner to past_due for a
 * gap in our own schema blames them for our omission, and past_due is a money
 * state that other screens read. The sweeper reports the skip and changes
 * nothing.
 */
export function instrumentRefusal(sub) {
  if (!sub) return "no_subscription";
  if (sub.partner_id != null) {
    return "no_partner_instrument";
  }
  if (sub.card_id == null) return "no_card_on_file";
  return null;
}

export default { resolveCharger, registerCharger, registeredChargers, instrumentRefusal };
