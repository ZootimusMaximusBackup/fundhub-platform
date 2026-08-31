// LAYER 2 — the weekly roll-up. Reads the observation log, computes the ten
// signals, ranks them, writes one ad_creative_signals row per creative per week.
//
// docs/specs/W2-creative-intelligence.md §6.6, §7.3, §7.4, §7.6.
//
// THIS MODULE DOES EXACTLY ONE THING BESIDES ARITHMETIC: FETCH. Every signal and
// the whole scoring model live in signals.mjs and score.mjs as pure functions
// over plain arrays, so they can be tested against hand-built sequences with no
// database. What is here is the SQL that feeds them and the SQL that stores the
// result — and keeping that separation is what makes the arithmetic auditable.
//
// HISTORY IS KEPT FOREVER. A row per creative per ISO week, never updated in
// place except by an explicit recompute of that same week. The death watch and
// every trend arrow are questions about last week versus this week; a table that
// only holds the current week can only say what is running now, which is what
// every competing product already does.

import { buildIndex, signalsFor } from "./signals.mjs";
import { rankWeek, topDecile, WEIGHTS_VERSION } from "./score.mjs";
import { buildSaturation } from "./saturation.mjs";
import { TAXONOMY_VERSION } from "./taxonomy.mjs";

/* isoWeek(date) → 'YYYY-Www'

   The ISO-8601 week, computed the standard way: the week containing the
   Thursday of that date. Written out rather than pulled from a dependency
   (CLAUDE.md §8 — no new dependencies without asking), and the reason it is not
   "day of year divided by seven" is that the answer differs for about a week
   every January and the difference is invisible until a New Year roll-up puts
   two weeks of data in one bucket. */
export function isoWeek(input = new Date()) {
  const d = new Date(input instanceof Date ? input.getTime() : `${String(input).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`isoWeek: bad date ${input}`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week decides the year.
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* weekBounds(isoWeekString) → { start, end } as YYYY-MM-DD, Monday to Sunday. */
export function weekBounds(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week));
  if (!m) throw new Error(`weekBounds: bad ISO week "${week}"`);
  const year = Number(m[1]);
  const wk = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4.getTime() - jan4Day * 86_400_000);
  const start = new Date(week1Monday.getTime() + (wk - 1) * 7 * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function previousWeek(week) {
  const { start } = weekBounds(week);
  return isoWeek(new Date(new Date(`${start}T00:00:00.000Z`).getTime() - 7 * 86_400_000));
}

/* computeWeek(db, { orgId, week, lookbackDays })

   Reads everything the signals need in three queries, computes, ranks, writes.

   LOOKBACK IS 120 DAYS BY DEFAULT and it is not arbitrary: ad age is the
   heaviest signal at 30% of the weight, so the window has to be long enough for
   a genuinely long-running ad to look long-running. Four months covers the
   spec's "an ad running 90 days is running because it makes money" and still
   keeps the read bounded. A creative older than the window has its age
   truncated, which UNDER-states it — the safe direction. */
export async function computeWeek(db, { orgId, week = isoWeek(), lookbackDays = 120 } = {}) {
  if (!orgId) throw new Error("computeWeek: orgId is required");
  const { start, end } = weekBounds(week);

  const [records, creatives, classifications, buckets] = await Promise.all([
    fetchRecords(db, orgId, end, lookbackDays),
    fetchCreatives(db, orgId),
    fetchClassifications(db, orgId),
    fetchTiktokBuckets(db, orgId, end, lookbackDays)
  ]);

  const clsMap = new Map();
  for (const c of classifications) {
    clsMap.set(c.content_hash, { angle: c.angle, promise_shape: c.promise_shape, ad_format: c.ad_format, funnel: c.funnel });
  }

  const index = buildIndex(records, creatives, clsMap);
  const prior = await priorTopDecile(db, orgId, week);

  const rows = [];
  for (const hash of index.observationsOf.keys()) {
    const signals = signalsFor(hash, index, {
      asOf: end,
      weekStart: start,
      priorTopDecile: prior,
      tiktokBucket: buckets.get(hash) || null
    });
    rows.push({ content_hash: hash, angle: clsMap.get(hash)?.angle || null, signals });
  }

  const ranked = rankWeek(rows);
  for (const row of ranked) await writeSignals(db, orgId, week, row);

  return {
    week,
    start,
    end,
    creatives: ranked.length,
    scored: ranked.filter((r) => r.winner_score_rank !== null).length,
    classified: clsMap.size,
    deathWatch: ranked.filter((r) => r.signals.death_watch === true).length,
    newEntrants: ranked.filter((r) => r.signals.new_entrant === true).length,
    weightsVersion: WEIGHTS_VERSION,
    taxonomyVersion: TAXONOMY_VERSION
  };
}

/* saturationForWeek — the angle x format x funnel grid for one week.

   "Live in the week" is defined as OBSERVED in the week, not as "has a signals
   row". A creative can have a signals row and have gone dark; counting it as a
   present competitor would make the map describe the past. */
export async function saturationForWeek(db, { orgId, week = isoWeek() } = {}) {
  const { start, end } = weekBounds(week);
  const { rows } = await db.query(
    `SELECT DISTINCT r.content_hash, r.advertiser_id,
            k.angle, k.ad_format, k.funnel
       FROM ad_library_records r
       JOIN ad_creative_classification k
              ON k.org_id = r.org_id AND k.content_hash = r.content_hash
       LEFT JOIN ad_watch_advertisers w
              ON w.org_id = r.org_id AND w.platform = r.platform
             AND w.external_advertiser_id = r.advertiser_id
      WHERE r.org_id = $1
        AND r.observed_on BETWEEN $2::date AND $3::date
        -- FundHub's own accounts are excluded from the map. They are watched so
        -- the owner console can show FundHub next to everyone else internally
        -- (§6.5), and counting them here would make FundHub a competitor in its
        -- own saturation numbers.
        AND coalesce(w.watch_group, 'direct') <> 'own'`,
    [orgId, start, end]
  );
  return { week, start, end, ...buildSaturation(rows) };
}

async function fetchRecords(db, orgId, end, lookbackDays) {
  const { rows } = await db.query(
    `SELECT content_hash, advertiser_id, platform, observed_on, first_seen_at,
            destination_url, placements
       FROM ad_library_records
      WHERE org_id = $1
        AND observed_on <= $2::date
        AND observed_on > ($2::date - $3::int)`,
    [orgId, end, lookbackDays]
  );
  return rows;
}

async function fetchCreatives(db, orgId) {
  const { rows } = await db.query(
    `SELECT content_hash, advertiser_id, platform, destination_domain,
            body_text, headline
       FROM ad_creatives_seen
      WHERE org_id = $1`,
    [orgId]
  );
  return rows;
}

async function fetchClassifications(db, orgId) {
  const { rows } = await db.query(
    `SELECT content_hash, angle, ad_format, promise_shape, funnel
       FROM ad_creative_classification
      WHERE org_id = $1 AND taxonomy_version = $2`,
    [orgId, TAXONOMY_VERSION]
  );
  return rows;
}

/* TikTok's ordinal bucket travels on the observation, not the creative, because
   the same creative can carry a different bucket in different weeks. The most
   recent non-null one wins. */
async function fetchTiktokBuckets(db, orgId, end, lookbackDays) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (content_hash)
            content_hash, raw->>'tiktok_perf_bucket' AS bucket
       FROM ad_library_records
      WHERE org_id = $1
        AND platform = 'tiktok'
        AND observed_on <= $2::date
        AND observed_on > ($2::date - $3::int)
        AND raw->>'tiktok_perf_bucket' IS NOT NULL
      ORDER BY content_hash, observed_on DESC`,
    [orgId, end, lookbackDays]
  );
  return new Map(rows.map((r) => [r.content_hash, r.bucket]));
}

/* priorTopDecile — last week's leaders, which is what the death watch is a
   watch OVER. Returns an empty set when there is no prior week, so the first
   ever run reports no deaths rather than reporting every creative as dead. */
export async function priorTopDecile(db, orgId, week) {
  const prev = previousWeek(week);
  const { rows } = await db.query(
    `SELECT content_hash, winner_score_rank
       FROM ad_creative_signals
      WHERE org_id = $1 AND iso_week = $2 AND winner_score_rank IS NOT NULL`,
    [orgId, prev]
  );
  return topDecile(rows);
}

async function writeSignals(db, orgId, week, row) {
  const s = row.signals;
  await db.query(
    `INSERT INTO ad_creative_signals
       (org_id, content_hash, iso_week, ad_age_days, variant_count, relaunch_count,
        creative_velocity, placement_spread, landing_page_changed, offer_price_cents,
        offer_term, new_entrant, death_watch, cross_platform_echo, tiktok_perf_bucket,
        winner_score, winner_score_rank, winner_score_band, weights_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (org_id, content_hash, iso_week) DO UPDATE SET
       ad_age_days = EXCLUDED.ad_age_days,
       variant_count = EXCLUDED.variant_count,
       relaunch_count = EXCLUDED.relaunch_count,
       creative_velocity = EXCLUDED.creative_velocity,
       placement_spread = EXCLUDED.placement_spread,
       landing_page_changed = EXCLUDED.landing_page_changed,
       offer_price_cents = EXCLUDED.offer_price_cents,
       offer_term = EXCLUDED.offer_term,
       new_entrant = EXCLUDED.new_entrant,
       death_watch = EXCLUDED.death_watch,
       cross_platform_echo = EXCLUDED.cross_platform_echo,
       tiktok_perf_bucket = EXCLUDED.tiktok_perf_bucket,
       winner_score = EXCLUDED.winner_score,
       winner_score_rank = EXCLUDED.winner_score_rank,
       winner_score_band = EXCLUDED.winner_score_band,
       weights_version = EXCLUDED.weights_version,
       computed_at = now()`,
    [orgId, row.content_hash, week,
     s.ad_age_days, s.variant_count, s.relaunch_count, s.creative_velocity,
     s.placement_spread, s.landing_page_changed, s.offer_price_cents, s.offer_term,
     s.new_entrant, s.death_watch, s.cross_platform_echo, s.tiktok_perf_bucket,
     row.winner_score, row.winner_score_rank, row.winner_score_band, WEIGHTS_VERSION]
  );
}
