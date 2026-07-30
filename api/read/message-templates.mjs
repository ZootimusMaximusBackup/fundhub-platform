// GET /api/read/message-templates — message templates — key, channel and compliance flag
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query }) =>
    db.query(`SELECT id, template_key, channel, subject, compliance_passed, source_doc,
           length(body) AS body_length, created_at, updated_at
      FROM message_templates
     WHERE ($3::text IS NULL OR channel = $3)
       AND ($4::text IS NULL OR template_key ILIKE '%' || $4 || '%')
     ORDER BY template_key
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.channel || null, query.q || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
