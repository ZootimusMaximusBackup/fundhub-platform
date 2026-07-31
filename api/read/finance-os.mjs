// GET /api/read/finance-os?client_id=<uuid> — the Finance OS screen's read.
//
// TRADELINES ONLY. This endpoint deliberately returns credit lines from the
// bureau pull and nothing else. The bank-connected surface — accounts,
// balances, card due dates, bills — is a separate endpoint
// (/api/read/banking-surface) behind a separate screen, because that data is
// governed by SOC 2 controls that are NOT in place (see the header of
// db/migrations/080_plaid_items.sql). Keeping them apart means this screen can
// ship while that one waits, and it means a reader of this handler can see at a
// glance that no bank data passes through it.
//
// client_id IS REQUIRED. Credit limits and balances are per-person financial
// detail; a paginated firehose of everybody's is not a screen anyone asked for,
// and it is exactly the kind of endpoint that becomes a breach. Same rule as
// api/read/tradelines.mjs.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, redact, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { toCalculatorCards } from "../../src/tradelines/index.mjs";
import { calcFunding } from "../../src/calculators/deal-funding.mjs";

// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter is
// { db, env } — src/http/middleware/requireAuth.mjs passes it straight to
// authenticate(), which destructures exactly those two names. A `roles` key
// there is accepted by the object literal and then silently dropped, so a gate
// declared that way never runs. api/read/tradelines.mjs shipped that hole once
// already; this endpoint calls requireRole() for real.
export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const query = req.query || {};
  const clientId = query.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  try {
    const client = (await db.query(
      `SELECT id, first_name, last_name, email FROM clients WHERE id = $1`, [clientId]
    )).rows[0];

    // A 404, not an empty screen. "No such client" and "a client with nothing on
    // file" are different answers and the screen words them differently.
    if (!client) {
      return res.status(404).json({ ok: false, error: "no client with that id" });
    }

    const rows = await listTradelines(db, {
      clientId,
      includeClosed: query.include_closed === "true"
    });

    // The calculator's own output, not a second implementation of it. With no
    // requestedAmount it returns the credit total and the guardrail and nulls
    // the allocation, which is the correct state for a screen nobody has typed
    // a number into.
    const requested = query.requested_amount == null || query.requested_amount === ""
      ? undefined
      : Number(query.requested_amount);

    const funding = calcFunding({
      cards: toCalculatorCards(rows),
      requestedAmount: Number.isFinite(requested) ? requested : undefined
    });

    return res.status(200).json({
      ok: true,
      client: redact(client),
      tradelines: {
        // Cents stay cents on the wire. The view model divides once, at the
        // point of display, and 054 is explicit that cents are the storage unit.
        rows: redact(rows.map((r) => ({
          id: r.id,
          lender: r.lender,
          kind: r.kind,
          credit_limit_cents: r.credit_limit_cents,
          balance_cents: r.balance_cents,
          apr: r.apr,
          source: r.source,
          as_of: r.as_of
        }))),
        funding
      }
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
