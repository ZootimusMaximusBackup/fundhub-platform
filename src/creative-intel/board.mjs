// The Winner's Board read model — and the wall.
//
// docs/specs/W2-creative-intelligence.md §9.3, §13.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PARTNER-FACING LINE, IMPLEMENTED RATHER THAN NOTED
//
// Owner decision: FundHub's own winning-creative performance is NOT handed to
// partners wholesale. That performance is the asset. Three things enforce it
// here, and all three are in the QUERY rather than in the screen:
//
//   1. FUNDHUB'S OWN ADS ARE EXCLUDED FROM THE FEED. Advertisers on the
//      watch-list in group 'own' are FundHub's accounts. They are watched so the
//      owner console can put FundHub next to everyone else internally, and the
//      partner-facing feed filters them out at the SQL level. Not hidden by CSS,
//      not filtered in JavaScript — never selected.
//
//   2. THE RAW WINNER SCORE IS NEVER PROJECTED. Rank and band only. The score
//      and the weights that produced it are the moat (§7.4 phase 2), and a
//      decimal on a screen is a decimal someone can regress the weights out of.
//
//   3. THE PROJECTION IS AN EXPLICIT COLUMN ALLOW-LIST, NEVER `SELECT *`. Same
//      discipline db/migrations/046_ad_platforms.sql:54-57 applies to encrypted
//      tokens: the comment there says a plaintext sibling column must never
//      exist because SOME `SELECT *` will eventually carry it into a JSON body.
//      Identical failure mode, identical defence. toPartnerRow() below is the
//      second lock — even a query that selects something it should not, cannot
//      put it in a response.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// NO EARNINGS CLAIMS, ANYWHERE
//
// Nothing this module returns is a revenue, income or results figure, and
// nothing here may grow one. FundHub's own projection files record ZERO measured
// paid closes. `offer_price_cents` is what a COMPETITOR asked for in their own
// ad copy — a quoted price, not an outcome, and it is labelled as such on the
// screen. The board sells ad intelligence; it never sells an income promise.

import { DO_NOT_COPY_RISKS } from "./taxonomy.mjs";
import { isoWeek, weekBounds, previousWeek } from "./weekly.mjs";
import { buildSaturation } from "./saturation.mjs";

/* Everything a partner may see about a creative. Anything not on this list does
   not reach a browser, whatever the SQL selected. */
export const PARTNER_COLUMNS = Object.freeze([
  "content_hash", "platform", "advertiser_id", "headline", "hook_line",
  "destination_domain", "media_kind",
  "angle", "ad_format", "promise_shape", "compliance_risk", "funnel",
  "ad_age_days", "variant_count", "relaunch_count", "creative_velocity",
  "placement_spread", "landing_page_changed", "offer_price_cents", "offer_term",
  "new_entrant", "death_watch", "cross_platform_echo", "tiktok_perf_bucket",
  "winner_score_rank", "winner_score_band", "iso_week",
  "do_not_copy", "rank_delta", "screen_state"
]);

/* Columns that exist in the tables and must NEVER reach a partner. Named
   explicitly so the test can assert against a list rather than against the
   absence of something nobody wrote down. */
export const WITHHELD_COLUMNS = Object.freeze([
  "winner_score",     // the raw number — the weights are recoverable from it
  "weights_version",  // which weight set produced it — internal
  "cost_cents",       // FundHub's model bill
  "input_tokens",
  "output_tokens",
  "raw",              // the vendor payload verbatim
  "vendor",
  "vendor_run_id",
  "watch_group"       // reveals which advertisers are FundHub's own
]);

/* The stated limitation that goes on the screen. §10: not a disclaimer in 8pt
   grey — a stated limitation, because per CLAUDE.md §2 absence is a finding and
   not a gap to paper over. Exported so the API and the page cannot disagree
   about the wording. */
export const RANK_BASIS_NOTE =
  "Ranks are based on how long ads run and how hard advertisers push them. " +
  "Outcome data is still being collected.";

export const NO_SPEND_NOTE =
  "No competitor spend figures appear here, and none ever will. " +
  "Nobody publishes them — every spend number in every other tool is a guess.";

/* toPartnerRow — the second lock. Allow-list, plus the two derived fields the
   screen needs so it does not have to re-derive them (and get them wrong). */
export function toPartnerRow(row = {}) {
  const out = {};
  for (const key of PARTNER_COLUMNS) {
    if (key in row) out[key] = row[key];
  }
  // A creative claiming a credit outcome or a guaranteed approval is shown
  // GREYED with a do-not-copy banner, never as inspiration. A partner who copies
  // one gets FundHub's ad accounts banned and FundHub's name on a complaint, so
  // the badge is computed server-side and travels with the row.
  out.do_not_copy = DO_NOT_COPY_RISKS.includes(row.compliance_risk) ||
    row.screen_state === "blocked";
  return out;
}

/* feedForWeek(db, { orgId, week, limit, offset, angle, band, platform })

   This week's movers — the top of the board — with last week's rank joined so
   the screen can draw a trend arrow.

   THE JOIN TO LAST WEEK IS A LEFT JOIN and a missing prior rank stays NULL. A
   creative that is new this week has no previous position; showing it as
   "risen from last" would invent a history it does not have. */
export async function feedForWeek(db, {
  orgId, week = isoWeek(), limit = 20, offset = 0,
  angle = null, band = null, platform = null, risk = null
} = {}) {
  const prev = previousWeek(week);
  const params = [orgId, week, prev, limit, offset];
  const where = [
    "s.org_id = $1", "s.iso_week = $2", "s.winner_score_rank IS NOT NULL",
    // Rule 1 of the wall — see the header.
    "coalesce(w.watch_group, 'direct') <> 'own'"
  ];
  if (angle) { params.push(angle); where.push(`k.angle = $${params.length}`); }
  if (band) { params.push(band); where.push(`s.winner_score_band = $${params.length}`); }
  if (platform) { params.push(platform); where.push(`c.platform = $${params.length}`); }
  if (risk) { params.push(risk); where.push(`k.compliance_risk = $${params.length}`); }

  const { rows } = await db.query(
    `SELECT ${SELECT_LIST},
            (prev.winner_score_rank - s.winner_score_rank) AS rank_delta
       FROM ad_creative_signals s
       JOIN ad_creatives_seen c
              ON c.org_id = s.org_id AND c.content_hash = s.content_hash
       LEFT JOIN ad_creative_classification k
              ON k.org_id = s.org_id AND k.content_hash = s.content_hash
       LEFT JOIN ad_watch_advertisers w
              ON w.org_id = c.org_id AND w.platform = c.platform
             AND w.external_advertiser_id = c.advertiser_id
       LEFT JOIN ad_creative_signals prev
              ON prev.org_id = s.org_id AND prev.content_hash = s.content_hash
             AND prev.iso_week = $3
      WHERE ${where.join(" AND ")}
      ORDER BY s.winner_score_rank ASC
      LIMIT $4 OFFSET $5`,
    params
  );
  return rows.map(toPartnerRow);
}

/* deathWatchForWeek — what dropped out of the top decile, and when.

   The differentiator. Everyone else's product is a search box over what is live
   NOW; knowing what STOPPED working is worth more than knowing what is running,
   and it is only computable because ad_library_records is append-only. */
export async function deathWatchForWeek(db, { orgId, week = isoWeek(), limit = 20, offset = 0 } = {}) {
  const { rows } = await db.query(
    `SELECT ${SELECT_LIST},
            (SELECT max(r.observed_on) FROM ad_library_records r
              WHERE r.org_id = s.org_id AND r.content_hash = s.content_hash) AS last_observed_on
       FROM ad_creative_signals s
       JOIN ad_creatives_seen c
              ON c.org_id = s.org_id AND c.content_hash = s.content_hash
       LEFT JOIN ad_creative_classification k
              ON k.org_id = s.org_id AND k.content_hash = s.content_hash
       LEFT JOIN ad_watch_advertisers w
              ON w.org_id = c.org_id AND w.platform = c.platform
             AND w.external_advertiser_id = c.advertiser_id
      WHERE s.org_id = $1 AND s.iso_week = $2
        AND s.death_watch IS TRUE
        AND coalesce(w.watch_group, 'direct') <> 'own'
      ORDER BY s.ad_age_days DESC NULLS LAST
      LIMIT $3 OFFSET $4`,
    [orgId, week, limit, offset]
  );
  return rows.map((r) => ({ ...toPartnerRow(r), last_observed_on: r.last_observed_on }));
}

/* newEntrantsForWeek — advertisers first seen this week.

   Grouped by advertiser rather than by creative: five ads from one newcomer is
   one new entrant, and listing it five times would turn the early-warning list
   into a duplicate feed. */
export async function newEntrantsForWeek(db, { orgId, week = isoWeek(), limit = 20 } = {}) {
  const { start, end } = weekBounds(week);
  const { rows } = await db.query(
    `SELECT c.advertiser_id, c.platform,
            count(DISTINCT c.content_hash)::int AS creatives,
            min(c.first_seen_at) AS first_seen_at,
            (w.id IS NOT NULL) AS on_watch_list
       FROM ad_creative_signals s
       JOIN ad_creatives_seen c
              ON c.org_id = s.org_id AND c.content_hash = s.content_hash
       LEFT JOIN ad_watch_advertisers w
              ON w.org_id = c.org_id AND w.platform = c.platform
             AND w.external_advertiser_id = c.advertiser_id
      WHERE s.org_id = $1 AND s.iso_week = $2 AND s.new_entrant IS TRUE
        AND coalesce(w.watch_group, 'direct') <> 'own'
      GROUP BY c.advertiser_id, c.platform, w.id
      ORDER BY creatives DESC, c.advertiser_id
      LIMIT $3`,
    [orgId, week, limit]
  );
  return { week, start, end, entrants: rows };
}

/* saturationForBoard — the grid, computed from the same rows the feed reads.

   FundHub's own advertisers are excluded here too. Counting them would make
   FundHub a competitor in its own saturation numbers and would tell every
   partner which cells FundHub occupies, which is exactly the information the
   wall exists to keep in. */
export async function saturationForBoard(db, { orgId, week = isoWeek() } = {}) {
  const { start, end } = weekBounds(week);
  const { rows } = await db.query(
    `SELECT DISTINCT r.content_hash, r.advertiser_id, k.angle, k.ad_format, k.funnel
       FROM ad_library_records r
       JOIN ad_creative_classification k
              ON k.org_id = r.org_id AND k.content_hash = r.content_hash
       LEFT JOIN ad_watch_advertisers w
              ON w.org_id = r.org_id AND w.platform = r.platform
             AND w.external_advertiser_id = r.advertiser_id
      WHERE r.org_id = $1
        AND r.observed_on BETWEEN $2::date AND $3::date
        AND coalesce(w.watch_group, 'direct') <> 'own'`,
    [orgId, start, end]
  );
  return { week, start, end, ...buildSaturation(rows) };
}

/* weeksAvailable — which weeks have been rolled up, newest first. The screen's
   week picker reads this instead of guessing that this week exists; on a fresh
   install it does not, and a picker that offers an empty week looks broken. */
export async function weeksAvailable(db, { orgId, limit = 12 } = {}) {
  const { rows } = await db.query(
    `SELECT iso_week, count(*)::int AS creatives, max(computed_at) AS computed_at
       FROM ad_creative_signals
      WHERE org_id = $1
      GROUP BY iso_week
      ORDER BY iso_week DESC
      LIMIT $2`,
    [orgId, limit]
  );
  return rows;
}

/* THE ALLOW-LIST, IN SQL. Written once and shared by the three feed queries so
   they cannot drift apart — three hand-maintained column lists is three places
   for `winner_score` to reappear. */
const SELECT_LIST = `
            s.content_hash, s.iso_week,
            c.platform, c.advertiser_id, c.headline, c.destination_domain, c.media_kind,
            k.angle, k.ad_format, k.promise_shape, k.compliance_risk, k.funnel,
            k.hook_line, k.screen_state,
            s.ad_age_days, s.variant_count, s.relaunch_count, s.creative_velocity,
            s.placement_spread, s.landing_page_changed, s.offer_price_cents, s.offer_term,
            s.new_entrant, s.death_watch, s.cross_platform_echo, s.tiktok_perf_bucket,
            s.winner_score_rank, s.winner_score_band`;

export { SELECT_LIST };
