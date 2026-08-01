/* The internal provider — today's behaviour, made explicit.
 *
 * Before this seam existed, sendTemplated() wrote a `messages` row with
 * provider='internal' and status='queued' and nothing ever read it again.
 * 'queued' was terminal. That was not a bug, it was the whole posture:
 * CLAUDE.md §12 records "Nothing transmits" as a deliberate property of this
 * build, and src/mail/ says the same thing at greater length — the drop is
 * gated on an FCRA report, a Deluxe compliance review and a lawyer signing off
 * on the broker/lender-of-record structure, none of which are code.
 *
 * So the default provider does nothing, on purpose, and says so in its status
 * rather than by silence. `held` is not `sent` and is not `failed`: there is
 * nothing wrong, and nothing went out.
 *
 * This is what every org is routed to by migration 110. Changing an org to a
 * provider that actually transmits is a deliberate UPDATE on
 * message_channel_routing, which is exactly where a decision like that belongs.
 */

export const key = "internal";

/* Cannot reach the outside world. Asserted across the whole provider set by
   src/messaging/no-transmit.test.mjs. */
export const transmits = false;

export async function send(_message = {}, _ctx = {}) {
  // No provider ref: nothing accepted it, so there is no id to carry. A
  // synthetic one here would look like a delivery receipt in the row.
  return { providerRef: null, status: "held" };
}
