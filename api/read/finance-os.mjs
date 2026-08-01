// GET /api/read/finance-os?client_id=<uuid> — the Finance OS grid.
//
// Seven numbers about one client's revolving credit, computed server-side by
// src/finance/os-grid.mjs so the screen and any future calculator cannot
// disagree. TRADELINES ONLY — see the module header; banking, liabilities and
// subscriptions are separate builds that are not on `main`, and the response
// says `source: "tradelines"` so the screen can print what it is looking at
// rather than implying it is looking at everything.
//
// client_id IS REQUIRED, for the same reason api/read/tradelines.mjs requires
// it: this is per-person financial detail, and a paginated firehose of
// everybody's balances is not a screen anyone asked for — it is the kind of
// endpoint that becomes a breach.
//
// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter is
// { db, env } and it is passed straight to authenticate(), which destructures
// exactly those two names — a `roles` key there is accepted by the object
// literal and then silently dropped. api/read/tradelines.mjs shipped that
// mistake once and the effective rule became "any authenticated staff session,
// any role" on an endpoint returning a named client's credit limits. Written out
// as a real requireRole() call here for the same reason it was fixed there.
//
// ROLE_SETS.STAFF, matching api/read/tradelines.mjs, which serves the same rows
// this endpoint summarises. Gating the summary more tightly than the detail
// would buy nothing: anyone refused here can read the underlying lines from the
// endpoint next door and add them up.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { financeOsGrid } from "../../src/finance/os-grid.mjs";

//
// ── AND THE SCOPE IS THE SESSION'S ORG, WHICH IT WAS NOT ──
// The role gate was written out correctly here from the start. The TENANT check
// was not: `client_id` came off the query string and reached a lookup filtered
// on client alone, so any authenticated staff session in any org could read any
// client's seven-row credit summary by knowing the uuid. A correct role gate
// over an unscoped read is still an unscoped read, and this endpoint summarises
// exactly the rows api/read/tradelines.mjs serves, so it had the same hole for
// the same reason.
//
// `staff.org_id` now scopes the query and listTradelines() refuses to run
// without an org. A session with no readable org is turned away rather than
// falling through to a query that happens to match nothing.
export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // FAIL CLOSED. No org on the session means no scope, and no scope is a
  // refusal — never an unscoped read.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  /* THE ORG BOUNDARY. Without this, ROLE_SETS.STAFF above was the only gate on a
     named client's financial detail — and it answers "are you staff", never "are
     they yours". Any employee of any company could read any client's figures
     given only an id. See src/http/client-scope.mjs. */
  // `database`, not `db` — this handler takes its handle from deps so the suite
  // can drive it without Postgres. Reaching past that to the module singleton
  // makes the ownership check the one query that ignores the injected handle,
  // and it fails with "DATABASE_URL not set" under every stubbed test.
  if (!(await requireClientInOrg(res, database, staff, String(query.client_id).trim()))) return;

  try {
    // Closed lines are excluded by listTradelines' default AND again by the
    // grid's own DRAWABLE filter. Belt and braces on purpose: the grid is the
    // thing under test, and it must be correct for any row set handed to it,
    // not only for the one this endpoint happens to fetch.
    const rows = await listTradelines(database, {
      // From the session, never the request. A client in another org matches
      // nothing, and the grid renders as "no lines" rather than as another
      // org's balances. Written as `orgId: staff.org_id` rather than passing the
      // validated local, because src/http/read-endpoints-org-scope.test.mjs on
      // the audit branch proves delegation by matching that exact text — an
      // endpoint excused from writing its own WHERE clause has to show, in
      // source, that it hands the SESSION's org to the store.
      orgId: staff.org_id,
      clientId: String(query.client_id).trim()
    });
    return res.status(200).json({ ok: true, ...financeOsGrid(rows) });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
