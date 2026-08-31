// Turn a paid white-label add-on link into the arrangement it bought.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails and fee timing. This
// handler is what puts a partner on a recurring cycle. It moves no money.
//
// REGISTRATION ORDER IS LOAD-BEARING. src/register-all.mjs registers this
// STRICTLY AFTER registerPaymentLinks(), because that handler is what flips the
// payment_links row to 'paid' and this one refuses to activate anything that is
// not paid yet. Handler order on the bus is registration order
// (src/events/bus.mjs:117 walks them in sequence and awaits each), the same
// reason purchase-routing is registered after money-chain. Move this earlier and
// every purchase reports `not_paid` and creates nothing — quietly, because that
// is a legitimate answer.
//
// IT MUST NOT THROW ON SOMEBODY ELSE'S PAYMENT. Every client payment in the
// system passes through here, and the only thing this handler may do with one
// is nothing at all: activateFromLink() looks for a payment_links row with a
// partner_id and returns { activated: false, reason: "not_a_partner_add_on" }
// when there is not one. A throw would land in the dead-letter table and make a
// client's successful payment look like a failure.
import { on } from "../events/registry.mjs";
import { activateFromLink } from "../subscriptions/partner-addons.mjs";

export async function onPaymentReceivedForAddOn(event, db) {
  const p = event.payload || {};

  /* THREE HANDLES, SAME PRIORITY ORDER src/handlers/payment-links.mjs USES.
     `ref` is our own link_ref round-tripped through the checkout metadata and
     is the only one that is ours; the session id is the fallback for a webhook
     that lost the metadata (119's header calls that out as unverified against a
     live sandbox). paymentLinkId is already resolved when the inbox row found
     the link itself. */
  const linkId = p.paymentLinkId || null;
  const linkRef = p.ref || null;
  const sessionId = p.itemId || p.productId || p.commasSessionId || null;
  if (!linkId && !linkRef && !sessionId) return { activated: false, reason: "no_link_handle" };

  return activateFromLink(db, {
    orgId: event.orgId || null,
    linkId,
    linkRef,
    commasSessionId: sessionId
  });
}

export function register() {
  on("payment.received", onPaymentReceivedForAddOn);
}
