/* The message dispatcher — the claim step.
 *
 * Before this file, `sendTemplated()` INSERTed a row with status='queued' and
 * nothing ever read it again: 'queued' was a terminal state and the outbox was
 * a write-only log. This is the loop that drains it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTHING CALLS THIS ON A SCHEDULE, AND THAT IS DELIBERATE
 *
 * There is no cron, no Netlify scheduled function, no bus subscription wired
 * to this module. It runs when something explicitly asks it to — today that is
 * the journey runner and the tests. Wiring it to a timer is a separate,
 * visible decision that belongs with Ticket 1's real providers, not smuggled
 * in underneath a test harness. Until then the blast radius of this file is
 * exactly the callers you can grep for.
 *
 * Combined with the provider set (memory and internal, neither of which
 * transmits), CLAUDE.md §12's "Nothing transmits" is still true after this
 * file exists.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE FENCE IS HERE AND NOT IN THE RUNNER
 *
 * `messages` rows are written by 27 files in src/workflows/, none of which
 * know the runner exists. A guard in the runner protects only what the runner
 * queued. A guard at the claim step protects every row no matter what put it
 * there — including a row queued by a workflow the runner triggered and then
 * lost track of. See src/messaging/live-fence.mjs for the three layers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STATUS VOCABULARY (documented on the columns in migration 110)
 *
 *   queued  → written by sendTemplated, waiting
 *   sending → claimed by this loop; a crashed process leaves rows here, which
 *             is recoverable-looking on purpose rather than silently requeued
 *   sent    → a provider accepted it
 *   held    → the internal provider, which does nothing by design
 *   refused → the fence rejected it. TERMINAL. Never retried, because every
 *             retry would be refused for the same reason and the row would
 *             churn forever.
 *   failed  → a provider threw
 */

import { resolve, ProviderError } from "./providers/index.mjs";
import { check as fenceCheck } from "./live-fence.mjs";

/* ON THE `resolveProvider` PARAMETER BELOW. It is a dependency injection, not
   a test mode. Ticket 8's rule is that the memory provider is selected ONLY
   through message_channel_routing, and that rule is intact: the DEFAULT and
   only production path is resolve(), which reads the routing table and nothing
   else. The parameter exists so the fence tests can stand up a provider whose
   `transmits` is true — which no module in this tree does yet — and prove the
   refusal paths close around it. Same pattern as c-06-crs-results-router's
   `detectDecline` and ds-02-diy-letters' `fetchImpl`. It does not select
   `memory`, and it cannot turn a refusal into a send: the fence runs after it
   on every path. */

/* Claim exactly one queued message for an org.
 *
 * FOR UPDATE SKIP LOCKED, the same pattern src/creative/generate.mjs uses to
 * drain generation_jobs: two workers racing cannot both take one row, and the
 * loser skips to the next rather than blocking on the winner.
 *
 * attempts is incremented AT CLAIM, not on success. A process that dies
 * mid-send has still used an attempt, and a counter that only counts happy
 * paths cannot bound a retry loop. */
async function claim(db, orgId) {
  const { rows } = await db.query(
    `UPDATE messages SET status = 'sending', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM messages
         WHERE org_id = $1 AND status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING id, org_id, client_id, channel, template_key, rendered_body, provider_ref, attempts`,
    [orgId]
  );
  return rows[0] || null;
}

/* The recipient. `messages` has no address column — it never needed one,
   because nothing ever sent. Derived from the client record per channel. */
function recipientFor(channel, client) {
  if (!client) return null;
  if (channel === "email") return client.email ?? null;
  return client.phone ?? null; // sms and voice both address a phone number
}

async function loadClient(db, clientId) {
  if (!clientId) return null;
  const { rows } = await db.query(
    `SELECT id, first_name, last_name, email, phone, custom_fields
       FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

async function finish(db, id, { status, providerRef, provider, error, at }) {
  await db.query(
    `UPDATE messages
        SET status = $2,
            provider = COALESCE($3, provider),
            provider_ref = COALESCE($4, provider_ref),
            last_error = $5,
            dispatched_at = $6
      WHERE id = $1`,
    [id, status, provider ?? null, providerRef ?? null, error ?? null, at]
  );
}

/* dispatchOne(db, { orgId, now, env }) → result | null
 *
 * null means the queue was empty. Otherwise a result describing what happened
 * to exactly one message, which the runner collects into its report. */
export async function dispatchOne(
  db,
  { orgId, now = Date.now, env = process.env, resolveProvider = resolve } = {}
) {
  const msg = await claim(db, orgId);
  if (!msg) return null;

  const at = new Date(typeof now === "function" ? now() : now);
  const client = await loadClient(db, msg.client_id);
  const to = recipientFor(msg.channel, client);

  let provider;
  try {
    provider = await resolveProvider(db, { orgId, channel: msg.channel });
  } catch (err) {
    // An unroutable channel is a permanent failure, not an outage. Retrying
    // would not conjure a routing row.
    const code = err instanceof ProviderError ? err.code : "provider_resolve_failed";
    await finish(db, msg.id, { status: "failed", error: code, at });
    return { id: msg.id, status: "failed", reason: code, channel: msg.channel, to, gates: [] };
  }

  // ── THE FENCE. Before the provider call, always. ────────────────────────
  const verdict = fenceCheck({ provider, client, to, env });
  if (!verdict.allowed) {
    await finish(db, msg.id, {
      status: "refused",
      provider: provider.key,
      error: verdict.reason,
      at
    });
    return {
      id: msg.id,
      status: "refused",
      reason: verdict.reason,
      channel: msg.channel,
      to,
      provider: provider.key,
      gates: verdict.gates
    };
  }

  try {
    const out = await provider.send(
      { ...msg, to, client, gates: verdict.gates },
      { now: at.getTime(), orgId }
    );
    const status = out?.status === "sent" ? "sent" : out?.status === "held" ? "held" : "failed";
    await finish(db, msg.id, {
      status,
      provider: provider.key,
      providerRef: out?.providerRef ?? null,
      error: status === "failed" ? "provider_returned_failure" : null,
      at
    });
    return {
      id: msg.id,
      status,
      channel: msg.channel,
      to,
      provider: provider.key,
      providerRef: out?.providerRef ?? null,
      templateKey: msg.template_key,
      gates: verdict.gates
    };
  } catch (err) {
    await finish(db, msg.id, {
      status: "failed",
      provider: provider.key,
      error: String(err?.message || err).slice(0, 500),
      at
    });
    return {
      id: msg.id,
      status: "failed",
      reason: "provider_threw",
      channel: msg.channel,
      to,
      provider: provider.key,
      gates: verdict.gates
    };
  }
}

/* Drain the queue for one org.
 *
 * `max` is a stop, not a target — the loop ends when the queue is empty. It
 * exists so a bug that requeues rows cannot spin forever, and hitting it is
 * reported rather than swallowed (CLAUDE.md: no silent caps). */
export async function dispatchQueued(
  db,
  { orgId, now = Date.now, env = process.env, max = 10000, resolveProvider = resolve } = {}
) {
  const results = [];
  let truncated = false;
  for (let i = 0; i < max; i++) {
    const r = await dispatchOne(db, { orgId, now, env, resolveProvider });
    if (!r) return { results, truncated };
    results.push(r);
    if (results.length === max) truncated = true;
  }
  return { results, truncated };
}
