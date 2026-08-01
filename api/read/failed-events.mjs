// GET /api/read/failed-events — the dead-letter queue — what broke, in which handler, and when
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

const run = readHandler({
  roles: ROLE_SETS.OPS,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT id, event_id, event_name, event_version, client_id, handler_name,
           error_message, error_code, status, attempts, max_attempts,
           first_seen_at, last_seen_at, next_attempt_at, resolved_at,
           resolution_note
      FROM failed_events
     WHERE org_id = $5::uuid
       AND ($3::text IS NULL OR status = $3)
       AND ($4::text IS NULL OR event_name = $4)
     ORDER BY last_seen_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.status || null, query.event_name || null, orgOf(staff)]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
