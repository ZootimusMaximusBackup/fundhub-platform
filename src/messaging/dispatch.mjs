// W4 — the outbound dispatcher.
//
// Takes queued messages that are due, puts each one through the compliance gate,
// and hands the survivors to the provider its org has routed that channel to.
//
// THE ORDER IS THE POINT. gate → route → send, always, with no path that
// reaches a provider without a gate result of exactly "allowed". Every early
// return below happens BEFORE the provider is resolved, which is not a style
// choice: it means a bug in the routing code cannot produce a send, because the
// provider module has not been loaded yet at the moment any block is decided.
//
// NOTHING IS SCHEDULED. This module exports functions. There is no cron, no
// Inngest registration, no timer, and no import of it from any route or
// workflow — dispatchDue() runs when something calls it, and today nothing does.
// Turning sending on is a separate, deliberate act (and INNGEST_EVENT_KEY is one
// of the three things CLAUDE.md §11 says to ask about first). Building the
// dispatcher did not start it.
//
// WHAT PROTECTS AGAINST DOUBLE SENDS. Three things, in order of reliability:
//   1. messages (org_id, provider_ref) unique index, migration 004 — the real
//      guarantee, applied when the row is created.
//   2. claimDue()'s UPDATE ... RETURNING, which flips status to 'sending' in the
//      same statement that selects the row. Two dispatchers racing cannot both
//      claim it; the second sees no row.
//   3. attempts / MAX_ATTEMPTS, which stops an infinite retry rather than a
//      duplicate.
// A plain SELECT-then-UPDATE would satisfy none of them.

import { gateAndRecord } from "./gate.mjs";
import { resolve, addressFieldFor } from "./providers/index.mjs";

/** How many times a message is retried before it is given up on. */
export const MAX_ATTEMPTS = 5;

/** How many messages one dispatch pass claims. Bounded so a backlog is worked
    through in steady batches rather than one pass trying to hold all of it. */
export const DEFAULT_BATCH = 50;

/* Outcome codes returned per message. Named so callers and tests agree on the
   vocabulary, and so a new outcome is a visible addition here rather than a new
   string literal buried in a branch. */
export const OUTCOME = Object.freeze({
  SENT: "sent",
  BLOCKED: "blocked",           // the gate held it
  NO_ROUTE: "no_route",         // no routing row, or the channel is disabled
  UNKNOWN_PROVIDER: "unknown_provider",
  CHANNEL_MISMATCH: "channel_mismatch",
  NO_ADDRESS: "no_address",
  REJECTED: "rejected",         // provider says never retry
  RETRY: "retry",               // provider says try again
  GAVE_UP: "gave_up"            // out of attempts
});

/* claimDue — take up to `limit` due messages and mark them 'sending' atomically.

   The UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) shape is what makes
   two dispatchers safe to run at once: SKIP LOCKED means the second one steps
   over rows the first has claimed instead of blocking on them, and the status
   flip is in the same statement as the selection so there is no window between
   deciding to send and recording that we did.

   scheduled_at IS NULL means due immediately — the shape every row queued by
   src/workflows/messaging.mjs is already in. */
export async function claimDue(db, { orgId = null, limit = DEFAULT_BATCH, now = null } = {}) {
  const { rows } = await db.query(
    `UPDATE messages m
        SET status = 'sending', last_attempt_at = now(), attempts = m.attempts + 1
       FROM (
         SELECT id FROM messages
          WHERE direction = 'outbound'
            AND status = 'queued'
            AND (scheduled_at IS NULL OR scheduled_at <= COALESCE($3::timestamptz, now()))
            AND ($1::uuid IS NULL OR org_id = $1)
            AND attempts < $4
          ORDER BY scheduled_at NULLS FIRST, created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE m.id = due.id
  RETURNING m.id, m.org_id, m.client_id, m.channel, m.rendered_body,
            m.template_key, m.provider_ref, m.attempts`,
    [orgId, limit, now, MAX_ATTEMPTS]
  );
  return rows;
}

/* routeFor — which provider carries this channel for this org.

   NO ROW, OR enabled = false, IS A HOLD. There is deliberately no fallback: a
   dispatcher that guesses when routing is missing is the failure
   message_channel_routing exists to prevent. */
async function routeFor(db, orgId, channel) {
  const { rows } = await db.query(
    `SELECT provider, enabled FROM message_channel_routing
      WHERE org_id = $1 AND channel = $2`,
    [orgId, channel]
  );
  return rows[0] || null;
}

/* addressFor — the destination, read off the client record.

   Which column depends on the provider, not the channel: Mailgun wants an email
   address, the GHL relay wants a contact id. Asking the provider (via
   ADDRESS_FIELD) rather than branching on its name here means adding a provider
   does not mean editing this file.

   The column name comes from the provider's own constant and is validated
   against an allow-list before it reaches SQL — a value that decides a column
   name must never be interpolated on trust. */
const ADDRESS_COLUMNS = new Set(["email", "phone", "ghl_contact_id"]);

async function addressFor(db, clientId, providerName) {
  const field = addressFieldFor(providerName);
  if (!field || !ADDRESS_COLUMNS.has(field)) return null;
  const { rows } = await db.query(
    `SELECT ${field} AS address FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return rows[0]?.address || null;
}

/* subjectFor — the email subject line.

   The messages table carries `rendered_body` but no subject column, so the
   subject lives on message_templates where the copy came from. Looked up only
   for email: SMS has no subject, and a query per text message to fetch a column
   that cannot apply is waste in the dispatcher's hot path.

   A missing subject is not fatal here — the provider decides. Mailgun accepts a
   message without one, and inventing a subject would be putting unreviewed copy
   in front of a client, which is exactly what the gate exists to stop. */
async function subjectFor(db, message) {
  if (message.channel !== "email" || !message.template_key) return null;
  const { rows } = await db.query(
    `SELECT subject FROM message_templates
      WHERE org_id = $1 AND template_key = $2 LIMIT 1`,
    [message.org_id, message.template_key]
  );
  return rows[0]?.subject || null;
}

/* dispatchOne — gate, route, send, record. One message.

   Returns { id, outcome, detail } and never throws: one poisoned message must
   not stop the batch behind it.

   `message` is a claimed row from claimDue(). */
export async function dispatchOne(db, message, options = {}) {
  const { fetchImpl, timeoutMs, signal, env, now } = options;

  try {
    // ---- 1. THE GATE, FIRST, ALWAYS ---------------------------------------
    // gateAndRecord writes blocked_reason/blocked_at and files the task. Note
    // this runs before any provider is resolved, so no code path here can reach
    // a provider with a non-allowed result.
    const verdict = await gateAndRecord(db, {
      orgId: message.org_id,
      clientId: message.client_id,
      channel: message.channel,
      body: message.rendered_body,
      messageId: message.id
    }, now ? { now } : {});

    if (verdict.state !== "allowed") {
      // gateAndRecord already set status='blocked'. Nothing further to write.
      return { id: message.id, outcome: OUTCOME.BLOCKED, detail: verdict.reasons.map((x) => x.code) };
    }

    // ---- 2. Routing --------------------------------------------------------
    const route = await routeFor(db, message.org_id, message.channel);
    if (!route || !route.enabled) {
      return await hold(db, message, OUTCOME.NO_ROUTE,
        route ? `${message.channel} is turned off for this org` : `no provider is routed for ${message.channel}`);
    }

    const provider = resolve(route.provider);
    if (!provider) {
      return await hold(db, message, OUTCOME.UNKNOWN_PROVIDER,
        `routing names "${route.provider}", which is not a known provider`);
    }
    if (!provider.CHANNELS.has(message.channel)) {
      return await hold(db, message, OUTCOME.CHANNEL_MISMATCH,
        `${route.provider} does not carry ${message.channel}`);
    }

    const address = await addressFor(db, message.client_id, route.provider);
    if (!address) {
      // Permanent for this message: no retry produces an address the client
      // record does not have.
      return await finalise(db, message, "failed", OUTCOME.NO_ADDRESS,
        `the client has no ${addressFieldFor(route.provider)} to send to`, route.provider);
    }

    // ---- 3. Send -----------------------------------------------------------
    const result = await provider.send({
      id: message.id,
      orgId: message.org_id,
      clientId: message.client_id,
      channel: message.channel,
      to: address,
      subject: await subjectFor(db, message),
      body: message.rendered_body,
      providerRef: message.provider_ref
    }, { fetchImpl, timeoutMs, signal, env });

    // ---- 4. Record ---------------------------------------------------------
    if (result.status === "sent") {
      await db.query(
        `UPDATE messages
            SET status = 'sent', provider = $2, provider_message_id = $3, last_error = NULL
          WHERE id = $1`,
        [message.id, route.provider, result.providerMessageId]
      );
      return { id: message.id, outcome: OUTCOME.SENT, detail: result.providerMessageId };
    }

    if (result.status === "rejected" || !result.retryable) {
      return await finalise(db, message, "failed", OUTCOME.REJECTED, result.error, route.provider);
    }

    // Retryable. Out of attempts is where a retry loop stops being a retry loop.
    if (message.attempts >= MAX_ATTEMPTS) {
      return await finalise(db, message, "failed", OUTCOME.GAVE_UP,
        `gave up after ${message.attempts} attempts: ${result.error || "no reason given"}`, route.provider);
    }

    await db.query(
      `UPDATE messages SET status = 'queued', provider = $2, last_error = $3 WHERE id = $1`,
      [message.id, route.provider, result.error]
    );
    return { id: message.id, outcome: OUTCOME.RETRY, detail: result.error };
  } catch (err) {
    // A message that broke the dispatcher goes back on the queue rather than
    // being lost, and the reason is recorded. It stops on its own once attempts
    // run out — claimDue() will not pick up a row at MAX_ATTEMPTS.
    const detail = String((err && err.message) || err).slice(0, 300);
    try {
      await db.query(
        `UPDATE messages SET status = 'queued', last_error = $2 WHERE id = $1`,
        [message.id, detail]
      );
    } catch { /* the database is the thing that is broken; nothing to add */ }
    return { id: message.id, outcome: OUTCOME.RETRY, detail };
  }
}

/* hold — a configuration problem, not a message problem.

   Back to 'queued' and the attempt is given back, so fixing the routing row
   releases the backlog instead of leaving it stuck at the attempt ceiling. A
   missing route is nobody's message being wrong. */
async function hold(db, message, outcome, detail) {
  await db.query(
    `UPDATE messages
        SET status = 'queued', last_error = $2, attempts = GREATEST(attempts - 1, 0)
      WHERE id = $1`,
    [message.id, detail]
  );
  return { id: message.id, outcome, detail };
}

/* finalise — a permanent outcome. The message stops here. */
async function finalise(db, message, status, outcome, detail, provider) {
  await db.query(
    `UPDATE messages SET status = $2, provider = $3, last_error = $4 WHERE id = $1`,
    [message.id, status, provider || null, detail ? String(detail).slice(0, 300) : null]
  );
  return { id: message.id, outcome, detail };
}

/* dispatchDue — claim a batch and dispatch each one.

   Sequential rather than concurrent on purpose: providers rate-limit, and a
   burst of parallel sends against a shared limit turns into 429s that all
   classify as retryable and come back next pass. Throughput here is not the
   constraint; the batch size is. */
export async function dispatchDue(db, options = {}) {
  const claimed = await claimDue(db, options);
  const results = [];
  for (const message of claimed) {
    results.push(await dispatchOne(db, message, options));
  }
  return {
    claimed: claimed.length,
    results,
    counts: results.reduce((acc, x) => { acc[x.outcome] = (acc[x.outcome] || 0) + 1; return acc; }, {})
  };
}

export default dispatchDue;
