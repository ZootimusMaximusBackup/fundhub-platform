// GET /api/read/partner-home-tiles — the three Partner Home KPI tiles that now
// have a real, partner-scoped source. T10-02 deleted all six (see the audit
// comment in public/app/partner-galaxy.html) because none had one. Three still
// do not and stay deleted: Close Rate, Show Rate, Movement Today. This endpoint
// is the other three:
//
//   Cash Collected Today  — SUM(partner_revenue.share_amount) for the UTC day,
//                            the partner's own accrual rows (status <> 'void').
//                            Zero rows today is a real zero, never "not known".
//   Funded Today           — countFundingClients() from src/partners/floors.mjs,
//                            the SAME definition the production floor counts
//                            with, so this tile and the floor decision can never
//                            disagree. Reused, not re-derived.
//   Cost / Funded Client   — today's ad spend divided by Funded Today. Either
//                            side unknown -> null, rendered "not known" by the
//                            screen. Never a zero, never a divide-by-zero.
//
// UI-STANDARDS.md §7: every metric on screen carries a comparison, never a bare
// number. Cash and Funded also carry yesterday's real figure (same query, the
// day before) — never invented, never a placeholder. Cost / Funded Client has
// no "yesterday" of its own that would not misrepresent a ratio as a trend, so
// its comparison is its own two real inputs instead — spend and count, the exact
// numbers that produced it.
//
// WHERE "TODAY'S AD SPEND" COMES FROM. v_partner_spend_vs_ceiling (046) is one
// row per CEILING, not one row per partner — a partner can carry a 'campaign' or
// 'platform' ceiling alongside a 'partner' one, and their spend_today_cents
// overlap (both draw from the same ad_metrics_daily rows), so summing every row
// would double-count. The 'partner'-scope row is the one exception: 046's
// lateral join only narrows by campaign_id/platform for scope IN ('campaign',
// 'platform'), so a 'partner'-scope row's spend_today_cents already covers the
// whole partner, every campaign, every platform, with nothing to sum. The unique
// index on (partner_id, scope, campaign_id, platform) with NULLS NOT DISTINCT
// (046) guarantees at most one such row. No row -> no partner-level ceiling is
// configured -> genuinely unknown, not zero.
//
// THE GATE is partnerReadHandler's, not hand-rolled: requirePrincipal admits
// partner or staff, a partner principal is pinned to its own id (a partner_id in
// the query string is ignored, never honoured), a staff caller must name
// ?partner_id=, and every query below runs inside a withPartnerScope
// transaction, so the RLS policies from 045/046 apply on top of the explicit
// org_id/partner_id filters written out below.

import { db } from "../../src/db.mjs";
import { partnerReadHandler } from "../../src/http/partner-read-api.mjs";
import { countFundingClients } from "../../src/partners/floors.mjs";
import { toCents } from "../../src/commissions/money.mjs";

/** The [start, end) window this screen means by "today": the UTC calendar day.
    Every timestamp in this database is timestamptz (src/partners/floors.mjs's
    windowFor makes the same call, for the same reason) — a local-midnight
    boundary would move twice a year. Computed ONCE and handed to every query
    below, so "today" cannot mean two different things on the same screen. */
export function utcDayWindow(at = new Date()) {
  const start = new Date(Date.UTC(
    at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0
  ));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** PURE. Cost per funded client in cents, or null when the ratio cannot
    honestly be printed. Exported so this rule is provable without a database:
    a partner with no configured partner-level spend ceiling, and a partner
    with zero funded clients today, must both come back null — never $0 and
    never a division by zero dressed up as an answer. */
export function costPerFundedClientCents(adSpendTodayCents, fundedToday) {
  if (adSpendTodayCents === null || adSpendTodayCents === undefined) return null;
  if (!Number.isFinite(adSpendTodayCents)) return null;
  if (!Number.isInteger(fundedToday) || fundedToday <= 0) return null;
  return Math.round(adSpendTodayCents / fundedToday);
}

const SQL_PARTNER = `SELECT id, org_id FROM partners WHERE id = $1 AND org_id = $2 LIMIT 1`;

/* One scan of the 48h window, split into today/yesterday by FILTER rather than
   two round trips — partner_revenue_partner_idx (partner_id, status,
   occurred_at DESC) still drives it, since partner_id narrows to one partner
   before the FILTERs ever run. */
const SQL_CASH_TODAY_AND_YESTERDAY = `
  SELECT
    COALESCE(SUM(share_amount) FILTER (WHERE occurred_at >= $4 AND occurred_at < $5), 0)::text
      AS cash_today,
    COALESCE(SUM(share_amount) FILTER (WHERE occurred_at >= $3 AND occurred_at < $4), 0)::text
      AS cash_yesterday
    FROM partner_revenue
   WHERE org_id = $1 AND partner_id = $2
     AND status <> 'void'
     AND occurred_at >= $3 AND occurred_at < $5`;

const SQL_SPEND_TODAY = `
  SELECT spend_today_cents
    FROM v_partner_spend_vs_ceiling
   WHERE org_id = $1 AND partner_id = $2 AND scope = 'partner'
   LIMIT 1`;

/* Exported so the SQL can be executed directly by
   src/http/partner-home-tiles.pg.test.mjs — an endpoint whose query only ever
   runs behind an HTTP handler is one whose column names go unchecked until a
   partner opens the screen. */
export const fetchRows = async (tx, { partnerId, principal }) => {
  // THE ORG COMES FROM THE SESSION, never the query string — same C1 rule as
  // api/read/partner-production.mjs, and for the same reason: withPartnerScope's
  // RLS policy filters on partner_id alone, so this is what stops a partner_id
  // belonging to another company from resolving at all. A session with no org
  // matches no row and fails closed.
  const orgId = (principal && (principal.orgId || principal.org_id)) || null;
  const partner = (await tx.query(SQL_PARTNER, [partnerId, orgId])).rows[0];
  if (!partner) return [];

  const { start, end } = utcDayWindow();
  const yesterdayStart = new Date(start.getTime() - 86_400_000);

  const [cashRow, spendRow, fundedToday, fundedYesterday] = await Promise.all([
    tx.query(SQL_CASH_TODAY_AND_YESTERDAY, [orgId, partnerId, yesterdayStart, start, end])
      .then((r) => r.rows[0]),
    tx.query(SQL_SPEND_TODAY, [orgId, partnerId]).then((r) => r.rows[0] || null),
    countFundingClients(tx, { orgId, partnerId, start, end }),
    // Same shared definition, same shared reasoning, one day earlier — never a
    // second, hand-written way to count a funding client.
    countFundingClients(tx, { orgId, partnerId, start: yesterdayStart, end: start })
  ]);

  // null = no partner-scope ceiling row = genuinely unknown, per the header note
  // above. 0 is a real, known value (a ceiling exists; nothing was spent yet).
  // spend_today_cents is ALREADY cents (COALESCE(SUM(ad_metrics_daily.spend_cents),
  // 0) in 046's view) — toCents() is not applied here, because that helper
  // expects a DOLLAR amount and would inflate an already-cents figure 100x.
  const adSpendTodayCents = spendRow ? Math.round(Number(spendRow.spend_today_cents)) : null;

  return [{
    partner_id: partnerId,
    window_start: start.toISOString(),
    window_end: end.toISOString(),
    // Always a real number — no accrual rows today is a real zero, not unknown.
    cash_collected_today_cents: toCents(cashRow.cash_today),
    cash_collected_yesterday_cents: toCents(cashRow.cash_yesterday),
    // Always a real integer — the exact SQL the production floor counts with.
    funded_today: fundedToday,
    funded_yesterday: fundedYesterday,
    ad_spend_today_cents: adSpendTodayCents,
    // null whenever either input above is unknown, or funded_today is 0 — see
    // costPerFundedClientCents.
    cost_per_funded_client_cents: costPerFundedClientCents(adSpendTodayCents, fundedToday)
  }];
};

const run = partnerReadHandler({ fetch: fetchRows, single: true });

export default (req, res) => run(req, res, { db });
