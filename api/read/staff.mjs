// GET /api/read/staff — staff directory — password_hash is stripped by redact() and never selected
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  fetch: (db, { limit, offset, query }) =>
    db.query(`SELECT s.id, s.name, s.email, s.role, s.status, s.assignment_order,
           s.last_assigned_at, s.created_at,
           (SELECT count(*)::int FROM tasks t
             WHERE t.assignee_staff_id = s.id AND t.done = false) AS open_tasks
      FROM staff s
     WHERE ($3::text IS NULL OR s.role = $3)
     ORDER BY s.name
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.role || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
