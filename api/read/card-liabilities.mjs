// GET /api/read/card-liabilities?client_id=<uuid> — what a client owes on each
// credit card, from the bank rather than from a credit report, personal and
// business.
//
// client_id IS REQUIRED, for the same reason it is required on
// api/read/tradelines.mjs: this is per-person financial detail, and a paginated
// firehose of everybody's card balances and due dates is not a screen anyone
// asked for. It is the kind of endpoint that becomes a breach.
//
// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter
// is `opts`, forwarded verbatim to authenticate(), which destructures { db, env }
// and nothing else. A `roles` key there is accepted by the object literal and
// silently discarded — which is exactly how api/read/tradelines.mjs shipped
// with no gate at all on a response containing a named client's credit limits.
// src/http/auth-gate.test.mjs fails the build on the broken shape.
//
// MONEY LEAVES AS INTEGER CENTS, WHICH IS DELIBERATELY DIFFERENT FROM
// api/read/tradelines.mjs. That endpoint converts to dollars at the boundary,
// which is the older convention here. This one does not, because every figure
// below is either a bank-reported balance or something computed from one, and a
// JSON float is the one representation the money rule in this repo exists to
// keep out of a money path. The `_cents` suffix says so at every field, and the
// screen divides once, where a rounding choice is a display decision rather
// than a stored number.
//
// UNKNOWN STAYS UNKNOWN ON THE WIRE. `utilisation` is null for a card with no
// known limit — it is NOT 0, and the summary refuses a blended figure whenever
// any contributing card is missing a number. Anything that renders this must
// show "—" rather than "0%": those are different facts about a client and one
// of them is a lie.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, redact, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listCardLiabilities } from "../../src/card-liabilities/store.mjs";
import {
  summarise, utilisation, availableCreditCents, asCents, asRate, mergeCardView
} from "../../src/card-liabilities/index.mjs";

/* Postgres hands bigint and numeric back as STRINGS. Shipping those verbatim
   would make every consumer parse them, and a consumer that forgot would
   compare '1000000' < '9' lexically and be wrong above a million. */
function wireRow(r) {
  return {
    id: r.id,
    client_id: r.client_id,
    account_ref: r.account_ref,
    tradeline_id: r.tradeline_id,
    issuer: r.issuer,
    last4: r.last4,
    is_business: r.is_business,          // true / false / null — three states
    credit_limit_cents: asCents(r.credit_limit_cents),
    balance_cents: asCents(r.balance_cents),
    statement_balance_cents: asCents(r.statement_balance_cents),
    minimum_payment_cents: asCents(r.minimum_payment_cents),
    apr_purchase: asRate(r.apr_purchase),
    apr_cash_advance: asRate(r.apr_cash_advance),
    apr_balance_transfer: asRate(r.apr_balance_transfer),
    statement_close_date: r.statement_close_date,
    payment_due_date: r.payment_due_date,
    as_of: r.as_of,
    closed_at: r.closed_at,
    // Derived here and stored nowhere, the rule 054 sets and 083 repeats.
    utilisation: utilisation(r.balance_cents, r.credit_limit_cents),
    available_cents: availableCreditCents(r.credit_limit_cents, r.balance_cents)
  };
}

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const query = req.query || {};
  const clientId = query.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  try {
    const rows = await listCardLiabilities(db, {
      clientId,
      includeClosed: query.include_closed === "true"
    });

    // THE ONE ANSWER. 083 is a second place that can say what a client owes —
    // db/migrations/083_card_liabilities.sql argues out loud for why it is a
    // separate table from `tradelines` — and this is the half of that argument
    // that has to be real rather than promised. Where a card is LINKED to the
    // bureau line for the same physical card, both rows go through
    // mergeCardView(), which applies one precedence rule (the bank wins any
    // field the bank reported; a NULL from the bank is not a correction) and
    // returns every field with its provenance attached. An UNLINKED card merges
    // to itself, so `merged` means the same thing on every row and a caller
    // never has to branch.
    //
    // Nothing populates tradeline_id yet, deliberately — matching a bank card
    // to a bureau card is a real matching problem and guessing at it is how a
    // client's available credit gets double counted. So today this is the
    // identity merge on every row. It is wired now rather than later because a
    // precedence rule with no caller is a comment, and the next person to need
    // it would write a second one.
    const linkedIds = [...new Set(rows.map((r) => r.tradeline_id).filter(Boolean))];
    const tradelines = linkedIds.length
      ? (await db.query(`SELECT * FROM tradelines WHERE id = ANY($1::uuid[])`, [linkedIds])).rows
      : [];
    const byId = new Map(tradelines.map((t) => [t.id, t]));

    return res.status(200).json({
      ok: true,
      data: redact(rows.map((r) => ({
        ...wireRow(r),
        merged: mergeCardView(r.tradeline_id ? byId.get(r.tradeline_id) ?? null : null, r)
      }))),
      // Split by classification, with the unclassified cards reported as their
      // own bucket rather than folded into personal. summarise() carries the
      // unknown COUNTS alongside the known sums so a caller can tell a partial
      // total from a whole one.
      summary: summarise(rows)
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}
