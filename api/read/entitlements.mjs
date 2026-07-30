// GET /api/read/entitlements — what a client holds, and what is still locked — the upsell surface
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
//
// SERVES CLIENTS TOO. client-portal.html is a client's own screen, so a client
// principal may read it — scoped to their OWN client_id, which is taken from the
// session and never from the query string. Before this, a signed-in client got
// 401 here and the portal showed a wireframe.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  principals: new Set(["client"]),
  fetch: (db, { limit, offset, query, principal }) => {
    /* The scope, stated here rather than applied invisibly by the wrapper.
       A client sees exactly their own row set; ?client_id= is ignored for them,
       so editing the URL cannot widen it. Staff see whatever they ask for. */
    const isClient = principal && principal.kind === "client";
    const clientId = isClient ? (principal.clientId || null) : (query.client_id || null);

    // A client principal with no client_id on the session can read nothing.
    if (isClient && !clientId) return Promise.resolve([]);

    return db.query(
      `SELECT client_id, entitlement_code, entitlement_name, kind, sort_order,
              granted_at, expires_at, revoked_at, active, source_transaction_id
         FROM v_client_entitlements
        WHERE ($3::uuid IS NULL OR client_id = $3)
        ORDER BY client_id, sort_order
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, clientId]
    ).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth, requirePrincipal });
