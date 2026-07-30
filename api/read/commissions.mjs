// GET /api/read/commissions — staff commission ledger — who earned what, and whether it is settled
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
    db.query(`SELECT l.id, l.staff_id, s.name AS staff_name, l.employee_code, l.client_id,
           l.role, l.basis, l.amount, l.currency, l.status, l.split_percent,
           l.product_name_at_earning, l.earned_at, l.approved_at, l.paid_at,
           l.void_reason, l.created_at
      FROM commission_ledger l
      LEFT JOIN staff s ON s.id = l.staff_id
     WHERE ($3::uuid IS NULL OR l.client_id = $3)
       AND ($4::text IS NULL OR l.status = $4)
     ORDER BY l.earned_at DESC NULLS LAST, l.created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.status || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
