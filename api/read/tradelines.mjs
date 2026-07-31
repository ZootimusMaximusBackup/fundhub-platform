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
import { ROLE_SETS, requireRole, isUuid, redact, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { toCalculatorCards, fromCents } from "../../src/tradelines/index.mjs";
import {
  calcFunding,
  parseUtilizationThreshold,
  UTILIZATION_THRESHOLD_REFUSALS
} from "../../src/calculators/deal-funding.mjs";

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

  try {
    const rows = await listTradelines(db, {
      // The session's org, not the caller's parameter: a client id from
      // another org must return nothing rather than that consumer's cards.
      orgId: staff.org_id,
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

    /* THE GUARDRAIL THRESHOLD IS VALIDATED, AND IT WAS NOT.
       This line used to read
           ...(query.utilization_threshold ? { utilizationThreshold: Number(query.utilization_threshold) } : {})
       which put an unchecked query parameter straight into the only thing
       standing between a closer and a draw that costs the client their next
       funding round. `?utilization_threshold=0.99` parses, passes, and makes
       calcFunding's hard stop unreachable — at a 99% line no draw a real card
       can carry crosses it, so `guardrail.hardStop` is false for every deal and
       the screen says "clear". Nothing recorded that the line had been moved.
       `?utilization_threshold=abc` was worse still: Number("abc") is NaN, every
       comparison against NaN is false, and the guardrail silently reported no
       breach for the same reason while looking like it had run.

       The band and the refusals live in the calculator that acts on the number —
       src/calculators/deal-funding.mjs, parseUtilizationThreshold — so this
       endpoint and /api/finance/model cannot drift apart on what a legal
       threshold is. A bad one is a 400 naming the rule, never a clamp and never
       a silent fall back to the default: a caller who asked for a different line
       and quietly got the standard one has been answered about a deal they did
       not ask about. Omitting the parameter is not an error — calcFunding's own
       0.30 default applies, which is what every existing caller already gets. */
    let utilizationThreshold;
    if (query.utilization_threshold !== undefined && String(query.utilization_threshold).trim() !== "") {
      const parsed = parseUtilizationThreshold(query.utilization_threshold);
      if (!parsed.ok) {
        return res.status(400).json({
          ok: false,
          error: UTILIZATION_THRESHOLD_REFUSALS[parsed.reason] || "utilization_threshold is not usable",
          reason: parsed.reason
        });
      }
      utilizationThreshold = parsed.value;
    }

    const funding = calcFunding({
      cards,
      requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : undefined,
      ...(utilizationThreshold === undefined ? {} : { utilizationThreshold })
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
