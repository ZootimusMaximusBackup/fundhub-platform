// THE CHOKEPOINT. Every outbound call that can have an effect on a real client
// or a real vendor account goes through transmit(), and transmit() is the only
// function in this repository permitted to hold a live `fetch` for that purpose.
//
// WHY IT IS SHAPED THIS WAY. The previous fence was a condition each caller was
// trusted to remember. That design cannot be verified: a provider added next
// month either remembers or it does not, and nothing fails when it does not.
// Correctness that depends on every future author is not correctness.
//
// So the fence is not something a sender calls. It is something a sender cannot
// avoid, because the only route to the network runs through here, and
// src/lib/no-unfenced-transmit.test.mjs fails the build if any module reaches
// the network another way. Adding a bypass is possible, but not quietly — it
// takes an entry on an allow-list with a written reason, in a test a reviewer
// reads.
//
// TWO THINGS MUST BE TRUE BEFORE ANYTHING LEAVES:
//   1. The caller declared which fence it is behind — "messaging" (reaches a
//      person) or "adapters" (reaches a vendor). An undeclared or unrecognised
//      fence is BLOCKED. Forgetting the parameter cannot mean "send it".
//   2. That fence's flag is set to an explicit off value. See
//      src/lib/dry-run.mjs — unset, empty and unparseable all hold.
//
// NEVER THROWS. Callers classify outcomes; they do not handle transport
// exceptions. A blocked call returns the same shape as a failed one, with
// `blocked: true` so a caller can tell "we chose not to" from "it did not work".

import {
  fenceVerdict, MESSAGING_DRY_RUN, ADAPTERS_DRY_RUN
} from "./dry-run.mjs";

/** The fences. A caller names one; anything else is refused. */
export const MESSAGING = "messaging";
export const ADAPTERS = "adapters";

/* INTERNAL — infrastructure that has no effect on any client or client record:
   asking a language model a question, reading a document out of Drive, looking
   up a payment we already know about. These are NOT held by the dry-run flags,
   because holding them makes nobody safer and breaks the product for staff.
   Blocking an embedding call does not protect a consumer; it just stops search
   working while the fence is up.

   IT IS STILL NOT A BYPASS, AND THIS IS THE IMPORTANT PART. A caller must name
   INTERNAL out loud, and src/lib/no-unfenced-transmit.test.mjs pins the set of
   modules allowed to name it to an exact list. Adding one fails the build until
   somebody edits that list and says why. So the escape hatch exists, it is
   small, it is enumerated, and it cannot be widened quietly — which is the most
   that can be true of any escape hatch.

   If what you are adding can reach a person or change a record at a vendor, it
   is not INTERNAL, whatever it feels like. */
export const INTERNAL = "internal";

const FENCE_FLAG = Object.freeze({
  [MESSAGING]: MESSAGING_DRY_RUN,
  [ADAPTERS]: ADAPTERS_DRY_RUN
});

/** Fences that are real, in the sense that a flag can hold them. */
export const FENCED = Object.freeze([MESSAGING, ADAPTERS]);
const KNOWN_FENCES = new Set([...FENCED, INTERNAL]);

export const DEFAULT_TIMEOUT_MS = 10_000;

/** How much of an error is kept. It lands in messages.last_error, which
    operators read and paste into support threads, so it is bounded. */
export const MAX_ERROR_CHARS = 300;

/* redact — strip anything credential-shaped out of text bound for the database
   or the logs.

   Vendor errors echo back request context, and a misconfigured request can echo
   back the Authorization header with it. CLAUDE.md §8: never a secret in code,
   fixtures, or logs.

   Deliberately aggressive. A redacted error that is harder to read is a far
   cheaper mistake than a live API key sitting in a database column. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(api[_-]?key|apikey|token|secret|password|authorization)"?\s*[:=]\s*"?[^\s",}]+/gi,
      "$1=[redacted]")
    .replace(/\bkey-[A-Za-z0-9]{8,}/g, "[redacted]")
    .slice(0, MAX_ERROR_CHARS);
}

/** The shape returned when nothing was sent. Same fields as a real result so a
    caller that ignores `blocked` still sees a clean failure rather than a
    surprise `undefined`. */
function held(reason, fence) {
  return { ok: false, blocked: true, status: 0, body: null, headers: {}, error: reason, fence: fence ?? null };
}

/* readHeaders — response headers as a plain lower-cased object.

   Some vendors put the only copy of an identifier a caller needs in a header
   rather than the body: CRS returns the id its retention log is keyed by as
   `RequestID`, and nowhere else. Callers cannot reach the Response object —
   that is the whole point of the chokepoint — so the headers have to come back
   through here or they are unreachable.

   Never logged and never stored by this module. A header block can carry a
   Set-Cookie or an echoed Authorization, and the moment it lands somewhere
   durable it is a credential at rest. */
function readHeaders(res) {
  const out = {};
  try {
    res?.headers?.forEach?.((value, key) => { out[String(key).toLowerCase()] = value; });
  } catch { /* a stand-in Response with no iterable headers is not an error */ }
  return out;
}

/**
 * Make an outbound request, if the fence permits it.
 *
 * @param {string} url
 * @param {object} [init]                 Passed to fetch. method/headers/body.
 * @param {object} opts
 * @param {"messaging"|"adapters"} opts.fence   Required. Undeclared = blocked.
 * @param {string} [opts.what]            Short description for the log line.
 * @param {object} [opts.env]             Defaults to process.env.
 * @param {Function} [opts.fetchImpl]     Injected for tests. Does NOT bypass
 *                                        the fence — a test that wants a send
 *                                        must turn the fence off explicitly.
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean, blocked:boolean, status:number, body:any,
 *                     headers:Record<string,string>, error:string|null,
 *                     fence:string|null}>}
 */
export async function transmit(url, init = {}, {
  fence,
  what,
  env,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal
} = {}) {
  if (!KNOWN_FENCES.has(fence)) {
    /* Not a configuration problem — a programming one. Loud, because the fix is
       to name a fence and the alternative is a silent unguarded send. */
    return held(
      `outbound transmit refused: no fence declared${fence ? ` (got "${fence}")` : ""}. ` +
      `Pass fence: MESSAGING, ADAPTERS or INTERNAL from src/lib/outbound-fetch.mjs.`,
      fence
    );
  }

  const flag = FENCE_FLAG[fence];
  if (flag) {
    const verdict = fenceVerdict(flag, env);
    if (!verdict.allowed) {
      console.warn(`[fence] held ${what || url} — ${verdict.reason}`);
      return held(`${verdict.reason}${what ? ` (${what})` : ""}`, fence);
    }
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { ok: false, blocked: false, status: 0, body: null, headers: {},
      error: "no fetch implementation available", fence };
  }

  // AbortController rather than Promise.race: a race leaves the request running
  // and the socket open, which under load is a connection leak that presents as
  // the vendor rate-limiting us.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await doFetch(url, { ...init, signal: controller.signal });

    // Read as text and parse defensively. A gateway returning an HTML error page
    // under a JSON content-type is ordinary, and res.json() throwing there would
    // lose the status code — which is the part that decides retryable.
    const text = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON; keep text */ }

    return {
      ok: res.ok,
      blocked: false,
      status: res.status,
      body: parsed,
      headers: readHeaders(res),
      error: res.ok ? null : redact(text || `HTTP ${res.status}`),
      fence
    };
  } catch (err) {
    const aborted = err && (err.name === "AbortError" || err.name === "TimeoutError");
    return {
      ok: false,
      blocked: false,
      status: 0,
      body: null,
      headers: {},
      error: redact(aborted ? `timed out after ${timeoutMs}ms` : String((err && err.message) || err)),
      fence
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }
}

/** JSON POST — the shape almost every caller wants. */
export function postJsonTo(url, { headers = {}, body, contentType = "application/json", ...rest } = {}) {
  return transmit(url, {
    method: "POST",
    headers: { "Content-Type": contentType, ...headers },
    body
  }, rest);
}
