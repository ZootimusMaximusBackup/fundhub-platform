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
import { financeOsGrid } from "../../src/finance/os-grid.mjs";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  try {
    // Closed lines are excluded by listTradelines' default AND again by the
    // grid's own DRAWABLE filter. Belt and braces on purpose: the grid is the
    // thing under test, and it must be correct for any row set handed to it,
    // not only for the one this endpoint happens to fetch.
    const rows = await listTradelines(db, { clientId: String(query.client_id).trim() });
    return res.status(200).json({ ok: true, ...financeOsGrid(rows) });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
