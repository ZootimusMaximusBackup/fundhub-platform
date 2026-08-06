// Boot wiring — register every handler module onto the event bus exactly once.
// Call ensureRegistered() before serving traffic (the HTTP router does this).
// on() dedupes by fn reference, so calling register() twice is harmless; the flag
// just avoids redundant work.

import { register as registerLifecycle } from "./handlers/client-lifecycle.mjs";
import { register as registerComms } from "./handlers/comms.mjs";
import { register as registerPaymentLinks } from "./handlers/payment-links.mjs";
import { register as registerMoneyChain } from "./handlers/money-chain.mjs";
import { register as registerInquiryGate } from "./handlers/inquiry-gate.mjs";
import { register as registerInquiryDocs } from "./handlers/inquiry-docs.mjs";
import { register as registerAgentRuntime } from "./agents/runtime.mjs";

let _done = false;

export function registerAll() {
  registerLifecycle();
  registerComms();
  registerPaymentLinks();
  registerMoneyChain();
  registerInquiryGate();
  registerInquiryDocs();
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
