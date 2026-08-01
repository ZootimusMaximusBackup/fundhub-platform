/* The internal provider — today's behaviour, made explicit.
 *
 * Before this seam existed, sendTemplated() wrote a `messages` row with
 * provider='internal' and status='queued' and nothing ever read it again.
 * 'queued' was terminal. That was not a bug, it was the whole posture:
 * CLAUDE.md §12 records what may transmit and what may not, and src/mail/ says
 * the same thing at greater length — the drop is gated on an FCRA report, a
 * Deluxe compliance review and a lawyer signing off on the broker/lender-of-
 * record structure, none of which are code.
 *
 * So this provider does nothing, on purpose, and says so in its result rather
 * than by silence. It reports `rejected` with `retryable: false`: there is
 * nothing wrong, nothing went out, and nothing should try again. The dispatcher
 * records that as a permanent outcome, which is the honest one — a message
 * routed to `internal` is a message nobody has decided to send yet.
 *
 * MERGE NOTE (2026-08-01, five-branch merge). This module arrived with the
 * journey-runner branch, written against that branch's provider contract
 * (`key` / `transmits` / `send() -> { providerRef, status }`). It is rewritten
 * here against the cutover branch's contract, which is the one the dispatcher
 * in src/messaging/dispatch.mjs actually calls. Behaviour is unchanged: it
 * holds, and it cannot reach the outside world.
 */

export const PROVIDER = "internal";

/* Every channel. `internal` is the do-nothing destination, so there is no
   channel it should decline to be routed for. */
export const CHANNELS = new Set(["email", "sms", "voice"]);

/* "natural" means the dispatcher uses the channel's own client column — email
   for email, phone for sms and voice — rather than one fixed column. A
   provider that carries every channel cannot name a single one. */
export const ADDRESS_FIELD = "natural";

/* Never the routed default for any channel. Migration 110 seeds email to
   mailgun and sms to ghl_relay; this exists as a deliberate destination, not
   as a fallback. */
export const ENABLED = false;

/* Cannot reach the outside world. Asserted across the whole provider set by
   src/messaging/providers/providers.test.mjs. */
export const TRANSMITS = false;

export async function send(_message = {}, _options = {}) {
  // No provider message id: nothing accepted it, so there is no id to carry. A
  // synthetic one here would look like a delivery receipt in the row.
  return {
    status: "rejected",
    retryable: false,
    providerMessageId: null,
    error: "routed to the internal provider, which sends nothing"
  };
}

export default send;
