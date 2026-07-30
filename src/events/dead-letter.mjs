// Dead-letter queue — where a throwing handler lands instead of vanishing.
//
// src/events/bus.mjs dispatches handlers serially with `await handler(event, db)`
// and nothing around it, so one handler throwing skipped every sibling handler
// for that event and propagated out of emit() into whichever adapter called it.
// Nothing durable recorded which handler failed, on what payload, or why.
//
// This module is the recording and retry side. bus.mjs wires it in; everything
// here takes a db and plain values so it tests without a live Postgres.
//
// THE CONTRACT, and the part to be careful about: recording a failure must never
// itself throw into the dispatch path. If the dead-letter write fails — the table
// is missing, the connection dropped — the caller must still finish dispatching
// the remaining handlers. A monitoring system that takes down the thing it
// monitors is worse than none, so record() swallows its own errors and reports
// them in its return value.

// Backoff: 1m, 5m, 15m, 1h, 6h, 24h, then hold at 24h. Deliberately not
// exponential-from-one-second — these failures are integration failures (a
// provider down, a schema drift, a bad payload), and hammering a broken
// dependency ten times in the first minute helps nobody. The first retry is far
// enough out that a transient blip has cleared and close enough that a real
// outage is visible within the hour.
export const BACKOFF_MINUTES = [1, 5, 15, 60, 360, 1440];
export const MAX_ATTEMPTS = 7;

// Stacks are for debugging, not storage. Capped so a recursive failure cannot
// write a megabyte per row.
const MAX_STACK = 4000;
const MAX_MESSAGE = 1000;

export function backoffMinutes(attempts) {
  if (attempts < 1) return BACKOFF_MINUTES[0];
  const i = Math.min(attempts - 1, BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[i];
}

export function nextAttemptAt(attempts, from = new Date()) {
  return new Date(from.getTime() + backoffMinutes(attempts) * 60_000);
}

// handlerName — a stable identity for a handler function. Named functions give
// their name; anonymous ones would all collide under "", so they get a slot
// derived from their position in the registry, supplied by the caller.
export function handlerName(fn, fallback = "anonymous") {
  const n = fn && typeof fn === "function" ? fn.name : "";
  return n && n !== "anonymous" ? n : fallback;
}

function truncate(s, max) {
  const v = s == null ? "" : String(s);
  return v.length > max ? v.slice(0, max) + "…[truncated]" : v;
}

/* record — log one handler failure. Idempotent per (org, event, handler): a
   repeat bumps attempts and reschedules rather than inserting a second row.

   Returns { ok, id, attempts, status } on success, or { ok: false, error } if the
   queue itself could not be written. Never throws. */
export async function record(db, {
  orgId, eventId = null, eventName, eventVersion = 1, clientId = null,
  payload = {}, handler, error, maxAttempts = MAX_ATTEMPTS, now = new Date()
}) {
  try {
    const message = truncate((error && error.message) || String(error || "unknown error"), MAX_MESSAGE);
    const stack = error && error.stack ? truncate(error.stack, MAX_STACK) : null;
    const code = error && error.code != null ? truncate(String(error.code), 100) : null;

    // attempts is computed in SQL from the existing row so two concurrent
    // dispatches cannot both read 3 and both write 4.
    const r = await db.query(
      `INSERT INTO failed_events
         (org_id, event_id, event_name, event_version, client_id, payload,
          handler_name, error_message, error_stack, error_code,
          status, attempts, max_attempts,
          first_seen_at, last_seen_at, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',1,$11,$12,$12,$13)
       ON CONFLICT (org_id, event_id, handler_name) DO UPDATE SET
         attempts        = failed_events.attempts + 1,
         last_seen_at    = EXCLUDED.last_seen_at,
         error_message   = EXCLUDED.error_message,
         error_stack     = EXCLUDED.error_stack,
         error_code      = EXCLUDED.error_code,
         payload         = EXCLUDED.payload,
         -- A row an operator already resolved or ignored must not silently
         -- reopen as 'pending'; it reopens only because it failed again, which
         -- is exactly what this branch means.
         status          = CASE
                             WHEN failed_events.attempts + 1 >= failed_events.max_attempts
                             THEN 'exhausted' ELSE 'pending' END,
         resolved_at     = NULL,
         resolved_by     = NULL,
         next_attempt_at = CASE
                             WHEN failed_events.attempts + 1 >= failed_events.max_attempts
                             THEN NULL ELSE EXCLUDED.next_attempt_at END,
         updated_at      = now()
       RETURNING id, attempts, status`,
      [orgId, eventId, eventName, eventVersion, clientId, payload,
       handler, message, stack, code, maxAttempts, now, nextAttemptAt(1, now)]
    );

    const row = r.rows[0];
    return { ok: true, id: row.id, attempts: row.attempts, status: row.status };
  } catch (e) {
    // Recording must never break dispatch. Surface it, do not raise it.
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* due — rows ready for another attempt. `limit` bounds a batch so a backlog of
   thousands cannot become one enormous transaction. */
export async function due(db, { orgId, limit = 50, now = new Date() } = {}) {
  const r = await db.query(
    `SELECT id, event_id, event_name, event_version, client_id, payload,
            handler_name, attempts, max_attempts
       FROM failed_events
      WHERE org_id = $1 AND status = 'pending'
        AND next_attempt_at IS NOT NULL AND next_attempt_at <= $2
      ORDER BY next_attempt_at ASC
      LIMIT $3`,
    [orgId, now, limit]
  );
  return r.rows;
}

/* markResolved — a retry succeeded, or an operator handled it by hand. */
export async function markResolved(db, id, { by = null, note = null, now = new Date() } = {}) {
  const r = await db.query(
    `UPDATE failed_events
        SET status = 'resolved', resolved_at = $2, resolved_by = $3,
            resolution_note = COALESCE($4, resolution_note),
            next_attempt_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING id, status`,
    [id, now, by, note]
  );
  return r.rows[0] || null;
}

/* markIgnored — an operator decided it does not matter. Kept, never deleted. */
export async function markIgnored(db, id, { by = null, note = null, now = new Date() } = {}) {
  const r = await db.query(
    `UPDATE failed_events
        SET status = 'ignored', resolved_at = $2, resolved_by = $3,
            resolution_note = COALESCE($4, resolution_note),
            next_attempt_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING id, status`,
    [id, now, by, note]
  );
  return r.rows[0] || null;
}

/* reschedule — a retry failed again. Bumps attempts and pushes next_attempt_at
   out, or exhausts the row when it runs out of tries. */
export async function reschedule(db, id, { error = null, now = new Date() } = {}) {
  const cur = await db.query(
    `SELECT attempts, max_attempts FROM failed_events WHERE id = $1`, [id]);
  if (!cur.rows[0]) return null;
  const attempts = cur.rows[0].attempts + 1;
  const exhausted = attempts >= cur.rows[0].max_attempts;
  const r = await db.query(
    `UPDATE failed_events
        SET attempts = $2,
            status = $3,
            next_attempt_at = $4,
            last_seen_at = $5,
            error_message = COALESCE($6, error_message),
            updated_at = now()
      WHERE id = $1 RETURNING id, attempts, status, next_attempt_at`,
    [id, attempts, exhausted ? "exhausted" : "pending",
     exhausted ? null : nextAttemptAt(attempts, now), now,
     error ? truncate(error.message || String(error), MAX_MESSAGE) : null]
  );
  return r.rows[0];
}

/* retry — run one queued failure back through its handler. `resolveHandler`
   maps a handler_name to a function; a name that no longer resolves is a code
   change, not a transient fault, so the row is exhausted rather than retried
   forever against a handler that no longer exists. */
export async function retry(db, row, resolveHandler, { now = new Date() } = {}) {
  const fn = resolveHandler(row.handler_name, row.event_name);
  if (typeof fn !== "function") {
    await db.query(
      `UPDATE failed_events
          SET status = 'exhausted', next_attempt_at = NULL,
              error_message = $2, updated_at = now()
        WHERE id = $1`,
      [row.id, `handler "${row.handler_name}" is no longer registered for "${row.event_name}"`]
    );
    return { id: row.id, outcome: "unresolvable" };
  }

  try {
    await fn({
      id: row.event_id, name: row.event_name, version: row.event_version,
      orgId: row.org_id, clientId: row.client_id, payload: row.payload,
      isRetry: true
    }, db);
    await markResolved(db, row.id, { note: "retry succeeded", now });
    return { id: row.id, outcome: "resolved" };
  } catch (e) {
    const after = await reschedule(db, row.id, { error: e, now });
    return { id: row.id, outcome: after && after.status === "exhausted" ? "exhausted" : "rescheduled" };
  }
}

/* retryDue — the batch path. Walks the due rows and retries each. */
export async function retryDue(db, resolveHandler, { orgId, limit = 50, now = new Date() } = {}) {
  const rows = await due(db, { orgId, limit, now });
  const out = [];
  for (const row of rows) out.push(await retry(db, { ...row, org_id: orgId }, resolveHandler, { now }));
  return {
    attempted: out.length,
    resolved: out.filter((r) => r.outcome === "resolved").length,
    rescheduled: out.filter((r) => r.outcome === "rescheduled").length,
    exhausted: out.filter((r) => r.outcome === "exhausted").length,
    unresolvable: out.filter((r) => r.outcome === "unresolvable").length,
    results: out
  };
}

/* retryOne — the single-event replay path, by failed_events id. */
export async function retryOne(db, id, resolveHandler, { now = new Date() } = {}) {
  const r = await db.query(
    `SELECT id, org_id, event_id, event_name, event_version, client_id, payload,
            handler_name, attempts, max_attempts
       FROM failed_events WHERE id = $1`, [id]);
  if (!r.rows[0]) return null;
  return retry(db, r.rows[0], resolveHandler, { now });
}

/* summary — the health screen's read. Grouped counts, never payloads. */
export async function summary(db, { orgId } = {}) {
  const r = await db.query(
    `SELECT event_name, handler_name, status, rows, total_attempts,
            first_seen_at, last_seen_at, next_attempt_at, latest_error
       FROM v_failed_events_summary
      WHERE org_id = $1
      ORDER BY status, last_seen_at DESC`,
    [orgId]
  );
  const counts = { pending: 0, exhausted: 0, resolved: 0, ignored: 0 };
  for (const row of r.rows) counts[row.status] = (counts[row.status] || 0) + row.rows;
  return { counts, groups: r.rows };
}
