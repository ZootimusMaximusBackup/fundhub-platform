// GET /api/read/entitlements — what a client holds, and what is still locked — the upsell surface
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
    db.query(`SELECT client_id, entitlement_code, entitlement_name, kind, sort_order,
           granted_at, expires_at, revoked_at, active, source_transaction_id
      FROM v_client_entitlements
     WHERE ($3::uuid IS NULL OR client_id = $3)
     ORDER BY client_id, sort_order
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
