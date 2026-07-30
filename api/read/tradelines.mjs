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
import { ROLE_SETS, isUuid, redact, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { toCalculatorCards, fromCents } from "../../src/tradelines/index.mjs";
import { calcFunding } from "../../src/calculators/deal-funding.mjs";

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { roles: ROLE_SETS.STAFF });
  if (!staff) return;

  const query = req.query || {};
  const clientId = query.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
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
      ...(query.utilization_threshold ? { utilizationThreshold: Number(query.utilization_threshold) } : {})
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
