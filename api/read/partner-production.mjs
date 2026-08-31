// GET /api/read/partner-production — where a partner stands against the floor.
//
//   ?history=<1..24>   how many past reviews to return (default 6)
//
// WHY THIS ENDPOINT EXISTS. W1-money-model.md §6 promises the partner a banner in
// their own portal "naming the number and the date of the next check", and a
// warning nobody can read is not a warning. The monthly job
// (src/workflows/partner-production-floor.mjs) writes the judgements; this is the
// only way to read them back.
//
// IT SHOWS THE LIVE WINDOW TOO, not only the last verdict. A partner told on the
// 1st that they were nine short needs to know they are now three short — otherwise
// the only feedback on the one rule that ends the partnership arrives once a month
// and is a month stale. `current` is computed by the same
// SQL_COUNT_FUNDING_CLIENTS the job uses (src/partners/floors.mjs), so the number
// on the screen and the number in the decision can never disagree. It is a read:
// nothing is written and no share moves.
//
// "NEVER EVALUATED" IS NOT "IN GOOD STANDING". `latest` is null when no review row
// exists, and the payload says why in `not_evaluated_reason` — most often
// 'no_activation_date' (282 leaves that column NULL for every partner activated
// before it existed, on purpose) or 'in_grace'. A screen that rendered a missing
// verdict as a pass would tell a partner they had cleared a bar nobody had
// measured them against.
//
// THE GATE is partnerReadHandler's, not a hand-rolled one: requirePrincipal
// refuses any kind other than partner or staff, a partner principal is pinned to
// its own id (a partner_id in the query string is ignored, never honoured), and a
// staff caller must name a ?partner_id=. Every row then comes out of a
// withPartnerScope transaction, so 282's partner-isolation policy applies as well
// — one partner can never read another's review.

import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";
import {
  standingFor, isDue, windowFor,
  FLOOR_CLIENTS_PER_MONTH, WINDOW_DAYS, GRACE_DAYS, FIRST_EVAL_DAYS,
  DOWNGRADED_SHARE_PCT, CURE_DAYS
} from "../../src/partners/floors.mjs";

/* Exported so the payload can be exercised directly by
   src/http/partner-production-read.test.mjs. An endpoint whose query only ever
   runs behind an HTTP handler is one whose column names go unchecked until a
   partner opens the screen. */
export const fetchRows = async (tx, { partnerId, query = {}, principal = null }) => {
  /* THE ORG COMES FROM THE SESSION, never from the partner row and never from the
     query string. Binding it here is the C1 rule (src/http/read-endpoints-org-scope.test.mjs)
     and it is a real second lock rather than a formality: withPartnerScope's RLS
     policy filters on partner_id alone, so an org filter is what stops a partner
     id belonging to another company from resolving at all. A session with no org
     matches no row — it fails closed. */
  const orgId = principal && (principal.orgId || principal.org_id) || null;
  const partner = (await tx.query(
    `SELECT id, org_id, status, revenue_share_pct, activated_at
       FROM partners WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [partnerId, orgId]
  )).rows[0];
  if (!partner) return [];

  const history = Number(query.history) > 0 ? Number(query.history) : 6;
  const standing = await standingFor(tx, {
    orgId: partner.org_id, partnerId: partner.id, history
  });

  // Why there is no verdict yet, in the same vocabulary the job uses, so the
  // screen never has to guess between "not measured" and "passed".
  const { start, end } = windowFor(new Date());
  const due = isDue({
    activatedAt: partner.activated_at, status: partner.status,
    windowStart: start, windowEnd: end
  });

  return [{
    partner_id: partner.id,
    status: partner.status,
    // The CURRENT share, so the banner can say what a downgrade would cost — or
    // that it has already happened.
    revenue_share_pct: partner.revenue_share_pct,
    // NULL survives as NULL. It means the activation date is unknown, which is a
    // real state of this database, not a zero.
    activated_at: partner.activated_at,

    floor_per_month: standing.floorPerMonth,
    floor_clients: standing.floorClients,
    window_days: standing.windowDays,
    grace_days: GRACE_DAYS,
    first_evaluation_days: FIRST_EVAL_DAYS,
    downgraded_share_pct: DOWNGRADED_SHARE_PCT,
    cure_days: CURE_DAYS,

    latest: standing.latest,
    history: standing.history,
    current: standing.current,

    evaluable: due.due,
    not_evaluated_reason: standing.latest ? null : due.reason,
    // The date of the next check, which §6 requires the partner be told: the 1st
    // of the month after the window now in progress closes.
    next_review_at: nextFirstOfMonth(new Date())
  }];
};

/** The 1st of the next UTC month — the cadence in
    src/workflows/partner-production-floor.mjs, expressed as a date the screen can
    print. UTC for the same reason windowFor() uses it: a local boundary moves
    twice a year. */
export function nextFirstOfMonth(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/** Exported for the test: the floor is owner-set and a screen must not invent its
    own copy of the number. */
export const FLOOR_PER_MONTH = FLOOR_CLIENTS_PER_MONTH;
export const FLOOR_WINDOW_DAYS = WINDOW_DAYS;

const run = partnerReadHandler({ fetch: fetchRows, single: true });

export default (req, res) => run(req, res, { db });
