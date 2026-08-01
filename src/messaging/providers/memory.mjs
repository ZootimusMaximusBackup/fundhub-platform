/* The memory provider — records, never sends.
 *
 * This is the whole trick behind the journey runner, and it costs one routing
 * row. Point an org's channel at `memory` and the dispatcher runs for real: the
 * claim, the compliance gate, the quiet-hours deferral, the routing lookup, the
 * status writes. The only thing that changes is that the last inch appends to
 * an array instead of making an HTTP call.
 *
 * Consequences, all of them good:
 *   * zero external accounts required — no Twilio, no A2P registration, no
 *     Mailgun key, none of those external clocks block testing
 *   * every message that WOULD have gone out is inspectable: recipient, body,
 *     channel, and which fence decisions it passed on the way
 *
 * Selected only through message_channel_routing. There is deliberately no way
 * to force this provider from an environment variable or a function argument —
 * the routing table is already the switch. api/journeys/run.mjs makes the flip
 * inside the transaction it always rolls back, so the org's real routing is
 * never modified.
 *
 * THE RECORD IS IN-PROCESS AND UNBOUNDED. It lives for the life of the node
 * process and nothing prunes it, which is correct for a runner that walks a few
 * thousand paths and exits, and wrong for a long-lived server. Nothing routes an
 * org here by default (migration 110 seeds mailgun and ghl_relay), so the only
 * way to accumulate rows is to ask for them.
 *
 * MERGE NOTE (2026-08-01, five-branch merge). Rewritten from the journey-runner
 * branch's provider contract (`key` / `transmits` / `send() -> { providerRef,
 * status }`) onto the cutover branch's contract, which is what
 * src/messaging/dispatch.mjs calls. `recorded()` and `reset()` are unchanged —
 * the runner reads both.
 */

export const PROVIDER = "memory";

/* Every channel, because a run walks every journey and journeys send both. */
export const CHANNELS = new Set(["email", "sms", "voice"]);

/* "natural" — the channel's own client column. See internal.mjs. */
export const ADDRESS_FIELD = "natural";

/* Never routed by default. A run flips routing to it inside a transaction that
   is rolled back; nothing else should point at it. */
export const ENABLED = false;

/* Cannot reach the outside world. Asserted across the whole provider set by
   src/messaging/providers/providers.test.mjs. */
export const TRANSMITS = false;

const RECORDED = [];
let seq = 0;

/* send(message, options) → the dispatcher's result shape.
 *
 * `message` is what src/messaging/dispatch.mjs hands every provider:
 * { id, orgId, clientId, channel, to, subject, body, providerRef }. */
export async function send(message = {}, options = {}) {
  const now = options.now;
  const at = now ? new Date(typeof now === "function" ? now() : now).toISOString() : null;
  const providerMessageId = `memory:${++seq}`;
  RECORDED.push({
    providerMessageId,
    at,
    orgId: message.orgId ?? null,
    clientId: message.clientId ?? null,
    channel: message.channel ?? null,
    templateKey: message.templateKey ?? null,
    subject: message.subject ?? null,
    body: message.body ?? null,
    to: message.to ?? null,
    /* Which fence decisions this message got past. The caller stamps these on
       before dispatching; an empty array means it was dispatched outside the
       fence, which is itself worth being able to see. */
    gates: Array.isArray(message.gates) ? [...message.gates] : []
  });
  return { status: "sent", providerMessageId };
}

/* Everything recorded so far, newest last. A copy — callers filter and sort
   without disturbing the record. */
export function recorded() {
  return RECORDED.map((r) => ({ ...r, gates: [...r.gates] }));
}

/* Drop everything. Call between runs; a test that forgets sees the previous
   test's messages, which is the failure mode most likely to read as a pass. */
export function reset() {
  RECORDED.length = 0;
  seq = 0;
}

export default send;
