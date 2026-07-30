// GET /api/read/partners — partners with accrued balance — rate is per-partner config, never a constant
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
    db.query(`SELECT partner_id AS id, slug, name, status, revenue_share_pct,
           agreement_signed, balance_accrued, total_paid, open_accruals
      FROM v_partner_balance
     WHERE org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
       AND ($3::text IS NULL OR status = $3)
     ORDER BY name
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.status || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
