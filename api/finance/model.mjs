// /api/finance/model — the deal model. What a client actually walks away with,
// and how a draw should be spread across their cards.
//
//   POST { approved_funding, fee_pct?, fee_dollar?, down_payment?, ... ,
//          client_id?, requested_amount?, utilization_threshold? }
//        → { ok, deal, funding }
//
// `deal`    is calcDeal()    from src/calculators/deal-math.mjs    — net cash, fee split, monthly obligation, the cliff
// `funding` is calcFunding() from src/calculators/deal-funding.mjs — headroom, the waterfall, pay-method comparison, the guardrail
//
// *** SCAFFOLD STUB — TRACK 6 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 6 replaces the `not_implemented` body.
//
// *** POST, NOT GET, AND IT COMPUTES RATHER THAN STORES. *** Both calculators
// are pure — no database, no clock, no randomness — so this endpoint writes
// nothing. It is a POST because the input is a whole deal shape rather than a
// handful of query parameters, and because a URL carrying a named client's
// approved funding amount would land in every access log it passed through.
//
// *** THE ARITHMETIC IS NOT DONE IN THE BROWSER. *** public/app/closer-dashboard
// .html already reimplements a funding waterfall in inline JavaScript against
// sample rows, and that is exactly the drift this endpoint avoids: a second
// implementation in a <script> block is a second answer that goes stale
// (src/finance/os-grid.mjs:3). deal-model.html renders what this returns and
// decides nothing.
//
// *** THE DEPOSIT LOWERS NET CASH. IT IS NOT A DISCOUNT ON THE FEE. ***
// This was wrong until the scaffold pass fixed it, and it is the single number
// on this screen most likely to be read out loud to a client. calcDeal used to
// compute the fee taken from proceeds as `max(0, fee - downPayment)`, which
// treated the deposit as prepayment of the success fee — so paying MORE up front
// made net cash go UP. The two places that actually move money disagree:
// src/workflows/f-07-funding-locked.mjs:74 invoices the success fee as
// `approvedAmount * feePercent` with no deposit term at all, and
// db/migrations/011_sales.sql:82 makes `deposit` and `success_fee` separate,
// co-existing values of sale_payments.kind — the front end and the back end. So
// the deposit is money ON TOP of the fee, net cash is funding − fee − deposit,
// and on the worked example the old formula overstated it by $6,000. The
// regression test is 'a larger deposit LOWERS net cash to the client' in
// src/calculators/deal-math.test.mjs. Do not reintroduce the offset.
//
// *** THE GUARDRAIL MEASURES THE DELTA, NOT THE ABSOLUTE. *** calcFunding's hard
// stop fires when THIS DRAW pushes utilization across the threshold, not when
// the client is already over it. A client sitting at 38% on existing balances
// would fail an absolute 30% gate forever, at zero draw — that is a pre-existing
// condition, not a reason to block this deal. Render `hardStop` and
// `preExistingOver` as the different things they are.
//
// *** UNKNOWN MUST SURVIVE. *** Both calculators return null for anything that
// depends on a missing input — a card with no credit limit contributes no
// headroom, an unpriced line is never offered as the cheapest money. The screen
// renders null as an em dash. Never 0.00, and never a coalesced default.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";

/* ROLE_SETS.STAFF — closers and funding advisors model deals; that is the job.
   The inputs are numbers the caller supplies, and the only stored data this
   endpoint may touch is the named client's own cards, which api/read/tradelines
   .mjs already serves to this same set. deal-model.html is in the shared staff
   surface to match. */
const MODEL_ROLES = ROLE_SETS.STAFF;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, MODEL_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      // client_id is OPTIONAL: the model runs on numbers typed into the screen
      // with no client at all. When one IS named, their cards are read for the
      // waterfall — and that read is org-scoped like every other read here.
      if (body.client_id !== undefined && body.client_id !== null && body.client_id !== "") {
        if (!isUuid(body.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, body.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
      }

      // TODO(track 6): call calcDeal() and calcFunding() and return both.
      //
      // THE TWO CALCULATORS SPEAK DOLLARS, NOT CENTS. This is the seam most
      // likely to be got wrong: everything stored in this repository is integer
      // cents via src/commissions/money.mjs, and both calculators take and
      // return plain dollar numbers. Convert ONCE, at this boundary, and say so
      // in the response shape — two readings of one number a factor of 100
      // apart is the hazard money.mjs exists to guard, and it does not guard
      // this file automatically.
      //
      // When client_id is given, build `cards` for calcFunding from the client's
      // tradelines (src/tradelines/index.mjs toCalculatorCards() is the existing
      // mapping — reuse it rather than writing a second one) and pass the org's
      // configured utilization threshold rather than the 0.30 default.
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    // GET is not offered on purpose — see the header.
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}
