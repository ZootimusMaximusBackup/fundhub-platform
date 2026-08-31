// Boot wiring — register every handler module onto the event bus exactly once.
// Call ensureRegistered() before serving traffic (the HTTP router does this).
// on() dedupes by fn reference, so calling register() twice is harmless; the flag
// just avoids redundant work.

import { register as registerLifecycle } from "./handlers/client-lifecycle.mjs";
import { register as registerComms } from "./handlers/comms.mjs";
import { register as registerPaymentLinks } from "./handlers/payment-links.mjs";
import { register as registerPartnerAddOns } from "./handlers/partner-addons.mjs";
import { register as registerMoneyChain } from "./handlers/money-chain.mjs";
import { register as registerPartnerRecruit } from "./partners/recruit.mjs";
import { register as registerPurchaseRouting } from "./handlers/purchase-routing.mjs";
import { register as registerStaffCompAlerts } from "./handlers/staff-comp-alerts.mjs";
import { register as registerCustomerInsights } from "./handlers/customer-insights.mjs";
import { register as registerInquiryGate } from "./handlers/inquiry-gate.mjs";
import { register as registerInquiryDocs } from "./handlers/inquiry-docs.mjs";
import { register as registerInboundMmsDocs } from "./handlers/inbound-mms-docs.mjs";
import { register as registerCommasDisputes } from "./handlers/commas-disputes.mjs";
import { register as registerDiagnosticSoftPull } from "./handlers/diagnostic-soft-pull.mjs";
import { register as registerContractSigned } from "./handlers/contract-signed.mjs";
import { register as registerContractConsent } from "./handlers/contract-consent.mjs";
import { register as registerAgentRuntime } from "./agents/runtime.mjs";

let _done = false;

export function registerAll() {
  registerLifecycle();
  registerComms();
  registerPaymentLinks();
  /* White-label add-ons. STRICTLY AFTER registerPaymentLinks: that handler is
     what marks the link 'paid', and this one refuses to start a partner's
     recurring add-on off an ask that has not been paid. Handler order is
     registration order. It ignores every client payment. */
  registerPartnerAddOns();
  registerMoneyChain();
  /* The recruit bonus. STRICTLY AFTER registerMoneyChain: that handler writes
     the transactions row this one resolves as its idempotency key, and handler
     order on the bus is registration order. Registered earlier, the $2,000 is
     refused for want of a key rather than paid. It ignores every payment that
     is not a partner's $10,000 entry fee. */
  registerPartnerRecruit();
  /* Payment -> fulfilment board. Strictly after money-chain: handler order is
     registration order, and this reads the sale money-chain has just written to
     decide which board the client belongs on. */
  registerPurchaseRouting();
  /* After money-chain so sale_attributions exist when a deal-close win SMS runs. */
  registerStaffCompAlerts();
  registerCustomerInsights();
  registerInquiryGate();
  registerInquiryDocs();
  /* Photo texts after the inbound message row exists — same docs.received
     path as a portal upload. Must not mint a client. */
  registerInboundMmsDocs();
  /* Chargebacks and refunds → tasks. Registered after the money chain so a
     disputed payment's original payment.received has already been handled;
     these two events never reverse it, but the task text reads better when the
     payment it refers to is on file. */
  registerCommasDisputes();
  /* Soft pull must run even when Inngest is off — same sync rule as card
     placement on entry.captured. After money-chain so the client/tx exist. */
  registerDiagnosticSoftPull();
  registerContractSigned();
  registerContractConsent();
  // After comms: the inbound message row must exist before the runtime
  // looks it up by provider_ref. Handler order on the bus is registration order.
  registerAgentRuntime();
  _done = true;
}

export function ensureRegistered() {
  if (!_done) registerAll();
}

// Test helper — force re-registration on the next ensureRegistered().
export const _resetRegistered = () => { _done = false; };
