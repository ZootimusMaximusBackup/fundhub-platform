/* The messaging provider seam.
 *
 * A provider is the ONE place in this codebase that touches the outside world
 * on the way out. Faking exactly this seam fakes the entire outside world,
 * which is why the journey runner needs no test mode anywhere else — no env
 * var, no `if (testing)` branch, nothing threaded through the dispatcher.
 *
 * TICKET 1 IS NOT BUILT. See db/migrations/110_message_channel_routing.sql for
 * the full account. The two providers here are the ones Ticket 8 needs, and
 * NEITHER TRANSMITS:
 *
 *   internal — leaves the row exactly as sendTemplated wrote it. Today's
 *              behaviour, made explicit. The default for every org.
 *   memory   — records what would have gone out, in process, and returns a
 *              synthetic provider id.
 *
 * `twilio`, `mailgun` and `ghl-relay` are Ticket 1's work. They are absent
 * rather than stubbed: a stub that returns success is indistinguishable from a
 * send that worked, and that is the one confusion this seam exists to prevent.
 *
 * THE PROVIDER CONTRACT
 *
 *   export const key   — string, matches message_channel_routing.provider
 *   export const transmits — boolean. TRUE means this provider can reach the
 *                        outside world. src/messaging/no-transmit.test.mjs
 *                        asserts nothing in the tree sets it true today, so
 *                        adding a real vendor is a deliberate, visible act.
 *   export async function send(message, ctx) → { providerRef, status }
 *       message — the claimed `messages` row plus { to, client }
 *       ctx     — { now, orgId }; `now` is the clock, injected, never Date.now
 *       status  — "sent" | "failed"; anything thrown is treated as "failed"
 */

import * as memory from "./memory.mjs";
import * as internal from "./internal.mjs";

const PROVIDERS = new Map([
  [memory.key, memory],
  [internal.key, internal]
]);

export class ProviderError extends Error {
  constructor(message, { status = 500, code = "provider_error" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

/* Every provider this build knows about. Exported for the runner's report and
   for the tests that assert the transmit posture of the whole set. */
export function all() {
  return [...PROVIDERS.values()];
}

export function get(key) {
  return PROVIDERS.get(String(key || "").trim()) || null;
}

/* resolve(db, { orgId, channel }) → provider module
 *
 * REFUSES AN UNROUTED CHANNEL RATHER THAN FALLING BACK. A missing row could
 * mean "not configured yet" or "deliberately dark", those want opposite
 * behaviour, and picking one at dispatch time is how a message gets sent that
 * nobody chose to send. Migration 110 seeds an explicit 'internal' row for
 * every org and channel so the absence of a row is a real anomaly, not the
 * ordinary first-run state.
 */
export async function resolve(db, { orgId, channel } = {}) {
  if (!orgId) throw new ProviderError("orgId is required to resolve a provider", { code: "no_org" });
  if (!channel) throw new ProviderError("channel is required to resolve a provider", { code: "no_channel" });

  const { rows } = await db.query(
    `SELECT provider, enabled FROM message_channel_routing
      WHERE org_id = $1 AND channel = $2 LIMIT 1`,
    [orgId, channel]
  );
  const row = rows[0];
  if (!row) {
    throw new ProviderError(`no routing row for channel ${channel}`, { code: "channel_not_routed" });
  }
  if (row.enabled === false) {
    throw new ProviderError(`channel ${channel} is disabled`, { code: "channel_disabled" });
  }
  const mod = get(row.provider);
  if (!mod) {
    throw new ProviderError(`routing names unknown provider ${row.provider}`, { code: "unknown_provider" });
  }
  return mod;
}
