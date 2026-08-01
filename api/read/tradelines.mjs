// GET /api/read/tradelines?client_id=<uuid> — the Closer Dashboard's card table.
//
// This is the endpoint the finished funding calculators have been waiting on.
// It returns stored tradelines AND the calculator's own output for them, so the
// screen renders one consistent answer rather than reimplementing the waterfall
// in browser JS (which is what closer-dashboard.html does today against sample
// rows — see its CARDS block).
//
// client_id IS REQUIRED. Tradelines are per-person financial detail; a
// paginated firehose of everybody's card balances is not a screen anyone asked
// for, and it is exactly the kind of endpoint that becomes a breach.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, redact, unitFraction, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { toCalculatorCards, fromCents } from "../../src/tradelines/index.mjs";
import { calcFunding } from "../../src/calculators/deal-funding.mjs";

// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter
// is { db, env } — src/http/middleware/requireAuth.mjs passes it straight to
// authenticate(), which destructures exactly those two names. A `roles` key
// there is accepted by the object literal and then silently dropped, so the
// gate this endpoint declared never ran: the effective rule was "any
// authenticated staff session, any role", on an endpoint that returns a named
// client's credit limits and balances. staff.role is nullable with no CHECK
// against the catalog (deferred on purpose, per HANDOFF.md) and
// db/migrations/036_partner_role.sql seeds a 'partner' role into it, so the
// roles admitted beyond ROLE_SETS.STAFF were real, not theoretical.
//
// readHandler-based endpoints get this for free (it calls requireRole itself).
// This one is hand-rolled because it returns rows AND the calculator's output
// rather than a page, so the gate has to be written out. The endpoint was
// unrouted until now, which is the only reason this was never exploitable.
export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const query = req.query || {};
  const clientId = query.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  /* THE ORG BOUNDARY. Without this, ROLE_SETS.STAFF above was the only gate on a
     named client's financial detail — and it answers "are you staff", never "are
     they yours". Any employee of any company could read any client's credit
     limits, balances and APRs given only an id. This endpoint has already had one
     gate that looked like a control and was not (the `roles` key requireAuth
     ignores); this is the second. See src/http/client-scope.mjs. */
  if (!(await requireClientInOrg(res, db, staff, String(clientId).trim()))) return;

  // The guardrail ceiling arrives from the query string, and it used to reach
  // calcFunding as a bare Number() with no bounds. `?utilization_threshold=999`
  // set the ceiling to 99,900%, so no card could ever breach it; `=abc` passed
  // NaN, and every comparison against NaN is false, which disables the guardrail
  // just as completely but without looking wrong. Either way a caller could turn
  // off the one control that stops a closer over-drawing a client, by editing a URL.
  //
  // The wire value is a FRACTION — public/app/closer-dashboard.html:1132 sends
  // guard / 100 — so anything outside (0, 1] is not a threshold at all. Refused
  // rather than clamped: silently substituting a different ceiling would answer a
  // question the caller did not ask, which is how the guardrail got bypassed here
  // in the first place.
  const threshold = unitFraction(query.utilization_threshold);
  if (!threshold.valid) {
    return res.status(400).json({
      ok: false,
      error: "utilization_threshold must be a fraction greater than 0 and at most 1"
    });
  }

  try {
    const rows = await listTradelines(db, {
      clientId,
      includeClosed: query.include_closed === "true"
    });
    const cards = toCalculatorCards(rows);

    // requestedAmount is optional: with none, calcFunding returns the credit
    // total and the guardrail and nulls the allocation, which is the correct
    // state for a dashboard the closer has not yet typed a number into.
    const requestedAmount = query.requested_amount == null || query.requested_amount === ""
      ? undefined
      : Number(query.requested_amount);

    const funding = calcFunding({
      cards,
      requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : undefined,
      ...(threshold.present ? { utilizationThreshold: threshold.value } : {})
    });

    return res.status(200).json({
      ok: true,
      data: redact(rows.map((r) => ({
        ...r,
        // Dollars at the boundary — cents are the storage unit, not the wire
        // unit, and the screen should never divide by 100 itself.
        credit_limit: fromCents(r.credit_limit_cents),
        balance: fromCents(r.balance_cents),
        available: Math.max(0, (fromCents(r.credit_limit_cents) ?? 0) - (fromCents(r.balance_cents) ?? 0))
      }))),
      funding
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
