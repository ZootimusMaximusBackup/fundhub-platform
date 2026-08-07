// Shared HTTP plumbing for outbound message providers.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE OUTBOUND `fetch` NO LONGER LIVES HERE. It moved to
// src/lib/outbound-fetch.mjs, which is now the single chokepoint for every
// transmit in the repository, messaging and adapters alike.
//
// This file used to hold the only outbound fetch and say so. That was true when
// providers were the only thing that transmitted, but it stopped being true
// once adapters started posting to vendors, and a fence that only covers one of
// two doors is not a fence. Everything routes through the one function now, and
// src/lib/no-unfenced-transmit.test.mjs fails the build if a module finds
// another way out.
//
// What is unchanged: nothing in this directory decides WHETHER to send. The
// gate (src/messaging/gate.mjs) decides that, the dispatcher enforces the
// order, and providers only carry a message the gate already allowed.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY PROVIDERS SHARE THIS RATHER THAN EACH CARRYING THEIR OWN.
// Two providers with two hand-rolled timeout blocks is two chances to forget
// clearTimeout and leak a handle, and two different opinions about what counts
// as a transient failure. The retry classification in particular has to be
// identical across providers or the dispatcher's backoff behaves differently
// depending on which channel a message went out on.

import { postJsonTo, MESSAGING, redact as redactText, DEFAULT_TIMEOUT_MS as TIMEOUT, MAX_ERROR_CHARS as MAXERR }
  from "../../lib/outbound-fetch.mjs";

export const DEFAULT_TIMEOUT_MS = TIMEOUT;

/** How much of a provider's error text is kept. Operator-facing, and it lands
    in messages.last_error, so it is bounded rather than a whole HTML error page. */
export const MAX_ERROR_CHARS = MAXERR;

/** Re-exported from the chokepoint so there is one redactor, not two that
    drift. Providers and their tests keep importing it from here. */
export const redact = redactText;

/* postJson — one HTTP POST with a hard timeout, behind the messaging fence.

   THIS IS NOW A THIN WRAPPER, AND THAT IS THE POINT. The transport, the
   timeout and the fence all live in src/lib/outbound-fetch.mjs. A provider
   cannot reach the network except through this function, and this function
   cannot reach the network except through transmit(), which refuses unless
   MESSAGING_DRY_RUN is explicitly off. So a provider written next year is
   fenced whether or not its author has heard of the fence.

   Returns { ok, status, body, error } as before, plus `blocked: true` when the
   fence held it. NEVER THROWS.

   `fetchImpl` is still injectable for tests, and it still does NOT bypass the
   fence — a test that wants to observe a real send must turn the fence off
   explicitly via `env`. That is deliberate: an injected transport used to be an
   implicit "this is a test, let it through", and an implicit bypass is exactly
   the hole this work exists to close. */
export function postJson(url, {
  headers = {},
  body,
  contentType = "application/json",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
  signal,
  env,
  what
} = {}) {
  return postJsonTo(url, {
    headers,
    body,
    contentType,
    timeoutMs,
    fetchImpl,
    signal,
    env,
    what,
    fence: MESSAGING
  });
}

/* classify — HTTP status → the SendResult verdict, identically for every provider.

   THE DEFAULT IS RETRY, AND THAT DIRECTION IS CHOSEN ON PURPOSE. A message
   wrongly marked `rejected` is deleted work: it is never sent and nobody is
   told. A message wrongly marked `failed` is retried, and the give-up counter
   plus last_error surface it to an operator. So only a status that means "this
   specific request will never succeed as written" is permanent.

   In particular an auth failure (401/403) is RETRYABLE. The message is not
   wrong — the credential is — and once someone fixes the key the queued
   messages should go out rather than sit dead. */
export function classify(status) {
  if (status >= 200 && status < 300) return { status: "sent", retryable: false };
  // 400 is the only status that means the payload itself is unacceptable for
  // this recipient: a malformed address, a body the provider will not carry.
  // 422 is its validation-error twin.
  if (status === 400 || status === 422) return { status: "rejected", retryable: false };
  return { status: "failed", retryable: true };
}

/* failure / rejection / success — the three SendResult constructors.
   Every provider returns through these so the shape cannot drift between them. */
export const success = (providerMessageId) =>
  ({ status: "sent", providerMessageId, error: null, retryable: false });

export const failure = (error, { retryable = true } = {}) =>
  ({ status: "failed", providerMessageId: null, error: redact(error), retryable });

export const rejection = (error) =>
  ({ status: "rejected", providerMessageId: null, error: redact(error), retryable: false });
