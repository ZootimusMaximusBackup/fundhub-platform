/* The memory provider — records, never sends.
 *
 * This is the whole trick behind the journey runner, and it costs one routing
 * row. Point an org's channel at `memory` and the dispatcher runs for real:
 * the claim, the live-mode fence, the routing lookup, the status writes. The
 * only thing that changes is that the last inch appends to an array instead of
 * making an HTTP call.
 *
 * Consequences, all of them good:
 *   * zero external accounts required — no Twilio, no A2P registration, no
 *     Mailgun key, none of the external clocks block testing
 *   * every message that WOULD have gone out is inspectable: recipient, body,
 *     channel, and which fence decisions it passed on the way
 *
 * Selected only through message_channel_routing. There is deliberately no way
 * to force this provider from an environment variable or a function argument —
 * the routing table is already the switch.
 *
 * THE RECORD IS IN-PROCESS AND UNBOUNDED. It lives for the life of the node
 * process and nothing prunes it, which is correct for a runner that walks a
 * few thousand paths and exits, and wrong for a long-lived server. Nothing
 * routes an org here by default (migration 110 seeds 'internal'), so the only
 * way to accumulate rows is to ask for them.
 */

export const key = "memory";

/* Cannot reach the outside world. Asserted across the whole provider set by
   src/messaging/no-transmit.test.mjs. */
export const transmits = false;

const RECORDED = [];
let seq = 0;

/* send(message, ctx) → { providerRef, status }
 *
 * `message` is the claimed row plus { to, client }. `ctx.now` is the clock —
 * the virtual one under the runner, so a message recorded after a 180-day
 * sleep carries a timestamp 180 days out, not the wall clock. */
export async function send(message = {}, ctx = {}) {
  const at = ctx.now ? new Date(ctx.now).toISOString() : null;
  const providerRef = `memory:${++seq}`;
  RECORDED.push({
    providerRef,
    at,
    orgId: message.org_id ?? null,
    clientId: message.client_id ?? null,
    channel: message.channel ?? null,
    templateKey: message.template_key ?? null,
    body: message.rendered_body ?? null,
    to: message.to ?? null,
    // Which fence decisions this message got past. The dispatcher stamps these
    // on before calling; an empty array means it was dispatched outside the
    // fence, which is itself worth being able to see.
    gates: Array.isArray(message.gates) ? [...message.gates] : []
  });
  return { providerRef, status: "sent" };
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
