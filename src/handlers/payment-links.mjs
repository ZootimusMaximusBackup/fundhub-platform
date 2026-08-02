// src/handlers/payment-links.mjs — reacts to payment.received by settling the
// payment_links row that asked for it, if there is one.
//
// Most payment.received events have nothing to do with a payment link (every
// pre-existing Commas product — CRS, deposit, success fee, DIY — pays through
// its own fixed checkout page, not through this feature). This handler is a
// no-op for all of those: it only acts when the event payload carries `ref`,
// the reference commas.mjs's normalizeCommasEvent extracts from the webhook
// and which src/payment-links/index.mjs embeds in every checkout URL it
// builds. No ref, no match, nothing written — the same "ignore, don't guess"
// rule every other handler on this bus follows.
import { on } from "../events/registry.mjs";
import { markPaid } from "../payment-links/index.mjs";
import { toCents } from "../commissions/money.mjs";

export async function onPaymentReceivedForLink(event, db) {
  const p = event.payload || {};
  if (!p.ref) return;

  await markPaid(db, {
    linkRef: p.ref,
    commasSessionId: p.providerRef || null,
    // p.amount arrives in DOLLARS off the webhook (commas.mjs normalizeCommasEvent);
    // paid_amount_cents is a money column, so it crosses in cents like every other one.
    paidAmountCents: p.amount != null ? toCents(p.amount) : null
  });
}

export function register() {
  on("payment.received", onPaymentReceivedForLink);
}
