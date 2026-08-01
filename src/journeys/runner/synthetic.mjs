/* Throwaway clients, one per walked path.
 *
 * Every client the runner mints carries `custom_fields.synthetic = true` —
 * the marker src/messaging/live-fence.mjs refuses without, once a provider
 * that can transmit exists. Two reasons the marker is mandatory rather than
 * cosmetic, both recorded in Ticket 8:
 *
 *   1. a synthetic client must never appear on the closer dashboard next to a
 *      real one
 *   2. if the routing table is ever left pointing at a live provider by
 *      accident, a hard check on the marker is the second line of defence
 *
 * On (1): the runner's own answer is stronger than filtering. The API route
 * wraps a whole run in a transaction and rolls it back, so nothing a run mints
 * is ever visible to any dashboard — no rows to filter, and no deletes, which
 * CLAUDE.md §11 reserves for the owner. The marker remains as belt and braces
 * for anything that runs a walk outside that transaction.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS DOES NOT CALL api/dashboard/seed.mjs
 *
 * Ticket 8 says to reuse that route rather than write a second generator, and
 * the reasoning is right — two realistic-client generators would drift. Two
 * things stop it being a literal reuse, and both are about correctness, not
 * convenience:
 *
 *   * It is 100% inline in an HTTP handler. There is no exported function to
 *     call; reusing it means either an HTTP round-trip with an admin session
 *     or refactoring a live authed route.
 *   * It drives a full lead → survey → booked → paid → analysis → decision →
 *     sale sequence, ten canonical events. A journey walk needs a client at
 *     the START of a journey. Minting one through that sequence would fire
 *     `entry.captured`, `booking.created` and `payment.received` before the
 *     walk begins — the very events the walk is there to fire — and every
 *     workflow those triggered would be counted as "reached by this journey"
 *     when it was reached by the fixture.
 *
 * So this mints the minimum: one row, marked, with no history. A run's events
 * are the journey's events and nothing else's. Recorded as a deliberate
 * divergence from the ticket rather than done quietly.
 */

import { SYNTHETIC_FIELD } from "../../messaging/live-fence.mjs";

/* RFC 2606 reserves `.invalid` — guaranteed never resolvable, so a synthetic
   address cannot reach a real mailbox even if every other guard fails. */
export const SYNTHETIC_EMAIL_DOMAIN = "runner.fundhub.invalid";

/* 555-0100 through 555-0199 are the reserved fictional-number block. Same
   reasoning as the domain: unroutable by construction. */
const PHONE_BASE = 100;
const PHONE_MAX = 99;

export function syntheticEmail(runId, index) {
  return `journey-runner+${runId}-${index}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function syntheticPhone(index) {
  // Wraps within the reserved block rather than walking out of it. A run with
  // more than 100 paths reuses numbers, which is harmless — the fence keys on
  // the marker, and the allowlist is an additional filter, not an identity.
  return `+1555${String(PHONE_BASE + (index % (PHONE_MAX + 1))).padStart(4, "0")}`;
}

/* mint(db, { orgId, runId, index, journeyKey, pathId }) → client row
 *
 * A direct INSERT, not an emit. See the header: going through the event bus
 * would fire `entry.captured` and contaminate the very coverage the run is
 * measuring. */
export async function mint(db, { orgId, runId, index, journeyKey, pathId } = {}) {
  if (!orgId) throw new Error("mint: orgId is required");

  const email = syntheticEmail(runId, index);
  const custom = {
    [SYNTHETIC_FIELD]: true,
    synthetic_run_id: String(runId),
    synthetic_journey: String(journeyKey ?? ""),
    synthetic_path: String(pathId ?? "")
  };

  const { rows } = await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, phone, custom_fields, channel_source)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'journey-runner')
     RETURNING id, org_id, first_name, last_name, email, phone, custom_fields`,
    [orgId, "Runner", `Path ${pathId ?? index}`, email, syntheticPhone(index), JSON.stringify(custom)]
  );
  return rows[0];
}

/* Is this row one of ours? Used by the report, and by any caller that wants to
   assert a run left nothing behind. */
export function isSyntheticRow(row) {
  return row?.custom_fields?.[SYNTHETIC_FIELD] === true;
}

/* Count what a run left in the clients table. A run inside a rolled-back
   transaction should answer 0 afterwards; anything else is worth seeing. */
export async function countSynthetic(db, { orgId, runId } = {}) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM clients
      WHERE org_id = $1
        AND custom_fields->>'synthetic' = 'true'
        AND ($2::text IS NULL OR custom_fields->>'synthetic_run_id' = $2)`,
    [orgId, runId ?? null]
  );
  return rows[0]?.n ?? 0;
}
