// GET /api/read/funding-rounds — funding rounds — submitted, approved and funded amounts
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
    db.query(`SELECT id, client_id, round_number, status, product, submitted_amount,
           approved_amount, funded_amount, hold_reason, conditions, created_at
      FROM funding_rounds
     WHERE ($3::uuid IS NULL OR client_id = $3)
       AND ($4::text IS NULL OR status = $4)
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.status || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
