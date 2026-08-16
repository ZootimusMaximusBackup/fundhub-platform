// GET /api/read/affiliates — affiliates with derived balance and tier state from 033's view
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  principals: new Set(["affiliate"]),
  // Staff see the org roster. An affiliate session sees only their own row.
  // The org filter binds the CALLER's org, not orgs.is_default.
  fetch: (db, { limit, offset, query, staff, principal }) => {
    const isAffiliate = Boolean(principal && principal.kind === "affiliate");
    if (isAffiliate && !principal.affiliateId) return Promise.resolve([]);
    const orgId = isAffiliate
      ? (principal.orgId || null)
      : ((staff && staff.org_id) || null);
    const selfId = isAffiliate ? principal.affiliateId : null;
    return db.query(`SELECT a.id, a.name, a.status, a.tracking_id, a.tier_level, a.tier2_unlocked_at,
           a.recruited_by, a.direct_downline_count, a.balance_due, a.payout_status,
           (a.partner_license_signed_at IS NOT NULL) AS license_signed,
           a.created_at
      FROM affiliates a
     WHERE a.org_id = $4::uuid
       AND ($3::text IS NULL OR a.status = $3)
       AND ($5::uuid IS NULL OR a.id = $5)
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.status || null, orgId, selfId]).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth, requirePrincipal });
