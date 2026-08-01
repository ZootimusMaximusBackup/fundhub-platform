// GET /api/read/partners — partners with accrued balance — rate is per-partner config, never a constant
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else.
//
// SERVES PARTNERS TOO, each confined to their own row. This is the first
// production use of src/partners/scope.mjs, which was written as the tenancy
// boundary and then imported by nothing — so a partner who signed in read
// nothing at all. scopeFor() refuses to build a query for a partner principal
// with no partnerId, which is the behaviour that makes it safe to rely on here.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { scopeFor } from "../../src/partners/scope.mjs";

const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  principals: new Set(["partner"]),
  fetch: (db, { limit, offset, query, principal, staff }) => {
    // alias "v" — the view exposes partner_id directly.
    // startIndex is the number of placeholders ALREADY used ($1 limit, $2 offset),
    // so the scope predicate lands on $3.
    const scope = scopeFor(principal, { alias: "v", startIndex: 2 });
    const params = [limit + 1, offset, ...scope.params];
    const statusHole = `$${params.length + 1}`;
    params.push(query.status || null);

    /* THE ORG IS THE CALLER'S, NOT THE DEFAULT ONE (audit M3, and C1).
       This read filtered on `org_id = (SELECT id FROM orgs WHERE is_default
       LIMIT 1)` — a hardcoded lookup of whichever company is flagged default.
       That is worse than no filter in one respect: it READS as scoped. The
       moment a second company exists, its staff see the default company's
       partner roster and none of their own, which surfaces as "my list is
       empty" rather than as a leak — the wrong symptom to go chasing.

       Two principals reach this endpoint and they are scoped differently:

         a PARTNER is already pinned to their own partner_id by scope.sql
         above, which is a complete scope on its own;

         STAFF get the company off their session. A staff session with no org
         binds NULL and matches no row: it fails CLOSED, because the
         alternative hands a broken session every company's partner roster. */
    const isPartner = Boolean(principal && principal.kind === "partner");
    const orgHole = `$${params.length + 1}`;
    params.push(isPartner);
    const orgIdHole = `$${params.length + 1}`;
    params.push(isPartner ? null : ((staff && staff.org_id) || null));

    return db.query(
      `SELECT v.partner_id AS id, v.slug, v.name, v.status, v.revenue_share_pct,
              v.agreement_signed, v.balance_accrued, v.total_paid, v.open_accruals
         FROM v_partner_balance v
        WHERE (${orgHole}::boolean OR v.org_id = ${orgIdHole}::uuid)
          AND ${scope.sql}
          AND (${statusHole}::text IS NULL OR v.status = ${statusHole})
        ORDER BY v.name
        LIMIT $1 OFFSET $2`,
      params
    ).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth, requirePrincipal });
