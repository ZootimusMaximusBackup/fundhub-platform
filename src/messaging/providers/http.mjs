// Shared HTTP plumbing for outbound message providers.
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS IS THE FIRST OUTBOUND `fetch` IN THIS CODEBASE, AND THAT IS DELIBERATE.
//
// CLAUDE.md §12 records "Nothing transmits — there is no outbound fetch in
// src/adapters/ or src/lib/". That statement is still true of those two
// directories: both existing adapters (mailgun, twilio) are INBOUND webhook
// receivers, and the tests that assert "nothing transmits" are scoped to
// specific modules (src/alerts/store.mjs, src/banking/plaid.mjs,
// src/http/bank-accounts*.mjs, src/finance/soft-pulls.mjs) — none of them
// sweep this directory.
//
// src/messaging/providers/ is the one place in the repository allowed to make
// an outbound call, and only for a message that src/messaging/gate.mjs has
// already returned `allowed` for. Nothing here decides whether to send. If you
// are adding a fetch anywhere else, that is almost certainly the wrong place.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY PROVIDERS SHARE THIS RATHER THAN EACH CARRYING THEIR OWN.
// Two providers with two hand-rolled timeout blocks is two chances to forget
// clearTimeout and leak a handle, and two different opinions about what counts
// as a transient failure. The retry classification in particular has to be
// identical across providers or the dispatcher's backoff behaves differently
// depending on which channel a message went out on.

export const DEFAULT_TIMEOUT_MS = 10_000;

/** How much of a provider's error text is kept. Operator-facing, and it lands
    in messages.last_error, so it is bounded rather than a whole HTML error page. */
export const MAX_ERROR_CHARS = 300;

/* redact — strip anything credential-shaped out of text bound for the database.

   Provider errors echo back request context, and a misconfigured request can
   echo back the Authorization header with it. messages.last_error is read by
   operators and dumped into support threads, so a key that reaches it is a
   leaked key. CLAUDE.md §8: never a secret in code, fixtures, or logs.

   Deliberately aggressive — a redacted error that is harder to read is a
   cheaper mistake than a live API key in a database column. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(api[_-]?key|apikey|token|secret|password|authorization)"?\s*[:=]\s*"?[^\s",}]+/gi,
      "$1=[redacted]")
    .replace(/\bkey-[A-Za-z0-9]{8,}/g, "[redacted]")
    .slice(0, MAX_ERROR_CHARS);
}

/* postJson — one HTTP POST with a hard timeout.

   Returns { ok, status, body, error } and NEVER THROWS. A provider's job is to
   classify an outcome, not to handle transport exceptions, and an exception
   escaping into the dispatcher would be caught there and turned into a
   less-informative failure anyway.

   `fetchImpl` is an argument so tests drive real code paths without network
   access. That is the whole reason no provider needs a bypass flag: the seam
   is the transport, not the compliance logic. */
export async function postJson(url, {
  headers = {},
  body,
  contentType = "application/json",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl,
  signal
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, status: 0, body: null, error: "no fetch implementation available" };
  }

  // AbortController rather than Promise.race: race leaves the request running
  // and the socket open, which under load is a connection leak that presents
  // as the provider rate-limiting us.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A caller-supplied signal composes with ours — either can cancel.
  const onOuterAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType, ...headers },
      body,
      signal: controller.signal
    });

    // Read as text and parse defensively. A gateway returning an HTML error page
    // with a JSON content-type is ordinary, and res.json() throwing there would
    // lose the status code — which is the part that decides retryable.
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON; keep text */ }

    return {
      ok: res.ok,
      status: res.status,
      body: parsed,
      error: res.ok ? null : redact(text || `HTTP ${res.status}`)
    };
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      status: 0,
      body: null,
      error: redact(aborted ? `timed out after ${timeoutMs}ms` : String((err && err.message) || err))
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
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
