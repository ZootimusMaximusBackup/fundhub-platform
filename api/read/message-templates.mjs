// GET /api/read/message-templates — message templates — key, channel and compliance flag
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
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT id, template_key, channel, subject, compliance_passed, source_doc,
           length(body) AS body_length, created_at, updated_at
      FROM message_templates
     WHERE org_id = $5::uuid
       AND ($3::text IS NULL OR channel = $3)
       AND ($4::text IS NULL OR template_key ILIKE '%' || $4 || '%')
     ORDER BY template_key
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.channel || null, query.q || null, orgOf(staff)]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
