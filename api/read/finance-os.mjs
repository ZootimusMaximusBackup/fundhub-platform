// GET /api/read/finance-os?client_id=<uuid> — the Finance OS screen's cards.
//
// WHY THIS EXISTS ALONGSIDE api/read/tradelines.mjs. That endpoint is gated to
// ROLE_SETS.STAFF and takes client_id from the query string, which is correct
// for the Closer Dashboard: a closer looks at somebody else's file. Finance OS
// is the CLIENT's own subscription surface, so a signed-in client must be able
// to read it, and must be able to read ONLY their own row set. Widening the
// staff endpoint to admit clients would have put that scoping decision on an
// endpoint whose other caller does not want it.
//
// THE SCOPE IS TAKEN FROM THE SESSION, NEVER THE QUERY STRING, for a client.
// ?client_id= is ignored for a client principal, so editing the URL cannot
// widen it. Staff see whichever client they ask for. Same rule and same shape
// as api/read/entitlements.mjs, which is the existing precedent for an endpoint
// that serves both.
//
// ROWS ONLY — NO DERIVED TOTALS. Utilization and the portfolio sums are
// computed by src/http/finance-os-view.mjs, which the screen carries a verbatim
// copy of and which is unit-tested including every null case. Computing them
// here as well would create a second answer that can disagree with the first,
// which is the duplicate-implementation failure CLAUDE.md §8 warns about.
//
// TRADELINES ONLY. `public.cards` is a PIPELINE KANBAN card
// (client_id, pipeline_id, stage_id, owner) with no APR, limit or balance. The
// name collision has already cost time once; see 054_tradelines.sql.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  principals: new Set(["client"]),
  fetch: (db, { limit, offset, query, principal }) => {
    const isClient = principal && principal.kind === "client";
    const clientId = isClient ? (principal.clientId || null) : (query.client_id || null);

    // A client principal with no client_id on the session can read nothing.
    // Returning [] rather than the whole book is the fail-closed direction.
    if (isClient && !clientId) return Promise.resolve([]);
    // Staff must name a client. This endpoint returns per-person credit
    // balances; a paginated firehose of everybody's is not a screen anyone
    // asked for and is exactly the kind of endpoint that becomes a breach.
    if (!clientId) {
      const e = new Error("client_id is required");
      e.code = "BAD_REQUEST";
      return Promise.reject(e);
    }

    // Closed lines are excluded: the screen answers "what am I using now".
    // Cheapest money first, which is also the waterfall's draw order (054).
    return db.query(
      `SELECT id, client_id, lender, kind,
              credit_limit_cents, balance_cents, apr,
              source, account_ref, as_of, closed_at
         FROM tradelines
        WHERE client_id = $3
          AND closed_at IS NULL
        ORDER BY apr ASC NULLS LAST, lender ASC
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, clientId]
    ).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth, requirePrincipal });
