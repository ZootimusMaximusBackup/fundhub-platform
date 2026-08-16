// Settle payment_links when Commas says money cleared.
// Prefer link_ref (metadata). Fall back to Commas product/session id so a
// mismatched mint script cannot leave paid money invisible on the board.
import { on } from "../events/registry.mjs";
import { markPaid, markPaidBySession } from "../payment-links/index.mjs";
import { toCents } from "../commissions/money.mjs";

export async function onPaymentReceivedForLink(event, db) {
  const p = event.payload || {};
  const paidAmountCents = p.amount != null ? toCents(p.amount) : null;
  const sessionId = p.itemId || p.productId || p.commasSessionId || null;

  if (p.ref) {
    const byRef = await markPaid(db, {
      linkRef: p.ref,
      commasSessionId: sessionId || p.providerRef || null,
      paidAmountCents
    });
    if (byRef) return;
  }

  if (sessionId) {
    await markPaidBySession(db, {
      commasSessionId: sessionId,
      paidAmountCents
    });
  }
}

export function register() {
  on("payment.received", onPaymentReceivedForLink);
}
