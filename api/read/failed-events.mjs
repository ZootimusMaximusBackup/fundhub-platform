// GET /api/read/failed-events — the dead-letter queue — what broke, in which handler, and when
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.OPS,
  fetch: (db, { limit, offset, query }) =>
    db.query(`SELECT id, event_id, event_name, event_version, client_id, handler_name,
           error_message, error_code, status, attempts, max_attempts,
           first_seen_at, last_seen_at, next_attempt_at, resolved_at,
           resolution_note
      FROM failed_events
     WHERE ($3::text IS NULL OR status = $3)
       AND ($4::text IS NULL OR event_name = $4)
     ORDER BY last_seen_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.status || null, query.event_name || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
