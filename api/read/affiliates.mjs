// GET /api/read/affiliates — affiliates with derived balance and tier state from 033's view
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  // The org filter binds the CALLER's org, not orgs.is_default. is_default is
  // one fixed org — with a second org in the table it served org A's affiliate
  // roster to org B's staff. A session with no org_id binds null, which matches
  // no row: an empty page, never the whole table and never the default org's.
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT a.id, a.name, a.status, a.tracking_id, a.tier_level, a.tier2_unlocked_at,
           a.recruited_by, a.direct_downline_count, a.balance_due, a.payout_status,
           (a.partner_license_signed_at IS NOT NULL) AS license_signed,
           a.created_at
      FROM affiliates a
     WHERE a.org_id = $4::uuid
       AND ($3::text IS NULL OR a.status = $3)
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.status || null, (staff && staff.org_id) || null]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
