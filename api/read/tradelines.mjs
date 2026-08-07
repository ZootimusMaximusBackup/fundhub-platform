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
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { toCalculatorCards, fromCents } from "../../src/tradelines/index.mjs";
import {
  calcFunding,
  parseUtilizationThreshold,
  UTILIZATION_THRESHOLD_REFUSALS
} from "../../src/calculators/deal-funding.mjs";
import { listLenders } from "../../src/lenders/store.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";

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
//
// ── AND THE SCOPE IS THE SESSION'S ORG, WHICH IT WAS NOT ──
// The role gate above was fixed; the TENANT check was still missing. `client_id`
// arrives on the query string and went straight into a lookup that filtered on
// client alone, so any authenticated staff session in any org could read any
// client's credit limits and balances by knowing the uuid. A correct role gate
// over an unscoped read is still an unscoped read.
//
// `staff.org_id` now scopes the query, listTradelines() REFUSES to run without
// an org, and a session carrying no readable org is turned away here rather than
// falling through to a query that would match nothing by luck.
export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // FAIL CLOSED. No org on the session means no scope, and no scope must be a
  // refusal — never an unscoped read.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

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
  // `database`, not `db` — this endpoint takes its handle from deps so the suite
  // can drive it without Postgres. Reaching past that to the module singleton
  // would make the ownership check the one query in the handler that ignores the
  // injected handle, which reads as passing while never running under a stub.
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return;

  // The guardrail ceiling is validated below, inside the try, by
  // parseUtilizationThreshold — the calculator's own parser. This endpoint used
  // to run a second, local check here (unitFraction) that main and the audit
  // branch added independently for the same finding. Keeping both would have
  // meant the local one answering first with a generic message, so the parser's
  // `reason` — the thing that tells a caller WHICH rule they broke — could never
  // reach the wire. One validator, owned by the calculator that acts on the
  // number, so this endpoint and /api/finance/model cannot drift.

  try {
    const rows = await listTradelines(database, {
      // From the session. A client in another org matches nothing and the
      // response is an empty card table — which leaks less than a 404, because
      // a 404 would confirm the uuid names a real client somewhere. Written as
      // `orgId: staff.org_id` rather than passing the validated local, because
      // src/http/read-endpoints-org-scope.test.mjs on the audit branch proves
      // delegation by matching that exact text.
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

    // Real lender database match count for the closer dashboard / card stack.
    // Empty lenders → match_count 0, never a fabricated number.
    let lenders = [];
    let clientState = null;
    let inquiryLog = [];
    let demoMode = false;
    try {
      // Resolved once and passed to both gates. calcFunding excludes demo
      // lenders by default, so without this the count here would disagree with
      // the lender list while Demo Mode is on.
      demoMode = await orgDemoModeEnabled(db, staff.org_id);
      lenders = await listLenders(db, { orgId: staff.org_id, active: true, limit: 500, includeDemo: demoMode });
      const clientRow = await db.query(
        `SELECT custom_fields FROM clients
          WHERE org_id = $1::uuid AND id = $2::uuid`,
        [staff.org_id, clientId]
      );
      const c = clientRow.rows[0];
      if (c) {
        const cf = c.custom_fields || {};
        clientState = cf.business_state || cf.state || cf.home_state || null;
      }
      const inq = await db.query(
        `SELECT bureau, status, created_at FROM inquiry_log
          WHERE org_id = $1::uuid AND client_id = $2::uuid
          ORDER BY created_at DESC LIMIT 200`,
        [staff.org_id, clientId]
      );
      inquiryLog = inq.rows;
    } catch (_) {
      /* Lender match is additive — card funding still returns without it. */
    }

    const funding = calcFunding({
      cards,
      requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : undefined,
      ...(utilizationThreshold === undefined ? {} : { utilizationThreshold }),
      lenders,
      clientState,
      inquiryLog,
      includeDemo: demoMode
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
