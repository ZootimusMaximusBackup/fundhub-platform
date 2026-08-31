// LAYER 1 — turning vendor observations into rows.
//
// docs/specs/W2-creative-intelligence.md §6.6, §6.7.
//
// TWO WRITES PER OBSERVATION, AND THEY MEAN DIFFERENT THINGS.
//
//   ad_library_records   one row per (platform, external_ad_id, observed_on).
//                        APPEND-ONLY. This is the sequence six of the ten
//                        signals are computed from. A conflict is a no-op, so
//                        re-running a weekly pull costs nothing and duplicates
//                        nothing.
//
//   ad_creatives_seen    one row per content_hash. The DEDUPED creative — the
//                        row Layer 2 classifies. ~31,000 monthly records
//                        collapse to roughly 3,000 distinct creatives, and that
//                        collapse is about a 90% saving on the model bill.
//
// THE SECOND WRITE IS AN UPSERT THAT ONLY EVER WIDENS. first_seen_at moves
// earlier, last_seen_at moves later, placements and platforms_seen are unioned,
// observation_count increments. It never narrows, because a creative observed
// on fewer placements this week has not stopped having been observed on more
// last week — and placement spread is a signal about the advertiser's
// confidence over the creative's whole life, not this week's snapshot.
//
// RUNS AS STAFF. The RLS policies in 278 let a partner READ this pile and never
// write to it. The ingest job is FundHub's own job; it must not be invoked
// inside a partner-scoped transaction.

import { resolve as resolveVendor } from "./vendors/index.mjs";
import { OBSERVED_PLATFORMS } from "./taxonomy.mjs";

/* pullPlatform(db, { orgId, platform, vendorKey, observedOn, advertisers })
     → { platform, vendor, vendorRunId, costCents, observed, inserted, duplicates, creatives }

   `observed` counts what the vendor returned; `inserted` counts what was new.
   The two being different is the normal, healthy state on a re-run and is not
   an error — but the gap is reported rather than swallowed, because a pull that
   inserts zero rows week after week is a dead vendor and nothing else would
   ever say so. */
export async function pullPlatform(db, {
  orgId,
  platform,
  vendorKey = "fixture",
  observedOn = null,
  advertisers = null
} = {}, ctx = {}) {
  if (!orgId) throw new Error("ingest: orgId is required");
  if (!OBSERVED_PLATFORMS.includes(platform)) {
    throw new Error(`ingest: platform "${platform}" is not observed by Layer 1`);
  }

  const { module: vendor } = resolveVendor({ vendorKey });
  const result = await vendor.pull({ platform, observedOn, advertisers }, ctx);

  let inserted = 0;
  const hashes = new Map();

  for (const obs of result.observations) {
    const wrote = await insertObservation(db, orgId, obs, result);
    if (wrote) inserted += 1;
    // Collected per hash so the creative upsert runs once per distinct creative
    // per pull rather than once per observation. On a 7,200-record weekly pull
    // that is the difference between 7,200 upserts and roughly 700.
    const bucket = hashes.get(obs.contentHash);
    if (bucket) bucket.push(obs); else hashes.set(obs.contentHash, [obs]);
  }

  for (const [hash, group] of hashes) {
    await upsertCreative(db, orgId, hash, group);
  }

  return {
    platform,
    vendor: result.vendor,
    vendorRunId: result.vendorRunId ?? null,
    // Integer cents, and NULL survives — a vendor that did not report a bill has
    // not reported a bill of zero.
    costCents: result.costCents === null || result.costCents === undefined
      ? null
      : Number(result.costCents),
    observed: result.observations.length,
    inserted,
    duplicates: result.observations.length - inserted,
    creatives: hashes.size
  };
}

/* pullAll — every platform in one run, which is what the weekly cron does.

   ONE PLATFORM FAILING DOES NOT ABORT THE OTHERS. TikTok's Creative Center is
   free and unsupported by any contract; treating its outage as a reason to
   discard a successful Meta pull would throw away the data that matters most.
   The failure is reported per platform instead. */
export async function pullAll(db, opts = {}, ctx = {}) {
  const platforms = opts.platforms || OBSERVED_PLATFORMS;
  const runs = [];
  for (const platform of platforms) {
    try {
      runs.push(await pullPlatform(db, { ...opts, platform }, ctx));
    } catch (err) {
      runs.push({ platform, error: String((err && err.message) || err), observed: 0, inserted: 0 });
    }
  }
  const totalCost = runs.some((r) => r.costCents === null || r.costCents === undefined)
    ? null
    : runs.reduce((a, r) => a + r.costCents, 0);
  return {
    runs,
    observed: runs.reduce((a, r) => a + (r.observed || 0), 0),
    inserted: runs.reduce((a, r) => a + (r.inserted || 0), 0),
    costCents: totalCost,
    failed: runs.filter((r) => r.error).map((r) => r.platform)
  };
}

async function insertObservation(db, orgId, o, result) {
  // TikTok's ordinal performance bucket rides along inside `raw` rather than
  // getting a column of its own. It is the only vendor-specific metric any
  // source returns, it exists on one platform out of four, and it is an ORDINAL
  // — high/medium/low, never a rate. A dedicated numeric column would be an
  // invitation for someone to average it, and there is no way to turn a bucket
  // into a number (§16 item 2). weekly.mjs reads it back out of raw.
  const raw = o.tiktokPerfBucket
    ? { ...o.raw, tiktok_perf_bucket: o.tiktokPerfBucket }
    : o.raw;

  const { rowCount } = await db.query(
    `INSERT INTO ad_library_records
       (org_id, platform, external_ad_id, advertiser_id, observed_on,
        first_seen_at, last_seen_at, body_text, headline, cta,
        destination_url, destination_domain, media_kind, media_url,
        placements, raw, vendor, vendor_run_id, content_hash)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             $15::jsonb,$16::jsonb,$17,$18,$19)
     ON CONFLICT (org_id, platform, external_ad_id, observed_on) DO NOTHING`,
    [orgId, o.platform, o.externalAdId, o.advertiserId, o.observedOn,
     o.firstSeenAt, o.lastSeenAt, o.bodyText, o.headline, o.cta,
     o.destinationUrl, o.destinationDomain, o.mediaKind, o.mediaUrl,
     JSON.stringify(o.placements), JSON.stringify(raw),
     result.vendor, result.vendorRunId ?? null, o.contentHash]
  );
  return rowCount > 0;
}

/* upsertCreative — the widening upsert described in the header.

   The placement and platform unions are done in SQL rather than read-modify-
   write in JS on purpose: two pulls running concurrently (the weekly full and
   the daily light, §6.6) would otherwise race and one would clobber the other's
   union. jsonb ||-with-dedup is not a thing, so the union goes through a
   SELECT DISTINCT over the concatenation. */
async function upsertCreative(db, orgId, hash, group) {
  const first = group[0];
  const placements = [...new Set(group.flatMap((g) => g.placements))].sort();
  const platforms = [...new Set(group.map((g) => g.platform))].sort();
  const firstSeen = group
    .map((g) => g.firstSeenAt || `${g.observedOn}T00:00:00.000Z`)
    .sort()[0];
  const lastSeen = group
    .map((g) => g.lastSeenAt || `${g.observedOn}T00:00:00.000Z`)
    .sort()
    .slice(-1)[0];

  await db.query(
    `INSERT INTO ad_creatives_seen
       (org_id, content_hash, platform, advertiser_id, first_seen_at, last_seen_at,
        observation_count, body_text, headline, cta, destination_url,
        destination_domain, media_kind, media_url, placements, platforms_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)
     ON CONFLICT (org_id, content_hash) DO UPDATE SET
       first_seen_at = LEAST(ad_creatives_seen.first_seen_at, EXCLUDED.first_seen_at),
       last_seen_at  = GREATEST(ad_creatives_seen.last_seen_at, EXCLUDED.last_seen_at),
       observation_count = ad_creatives_seen.observation_count + EXCLUDED.observation_count,
       placements = (
         SELECT coalesce(jsonb_agg(DISTINCT p ORDER BY p), '[]'::jsonb)
           FROM jsonb_array_elements(ad_creatives_seen.placements || EXCLUDED.placements) AS p
       ),
       platforms_seen = (
         SELECT coalesce(jsonb_agg(DISTINCT p ORDER BY p), '[]'::jsonb)
           FROM jsonb_array_elements(ad_creatives_seen.platforms_seen || EXCLUDED.platforms_seen) AS p
       ),
       -- Text fields are NOT overwritten. The creative is keyed on a hash of
       -- them, so they cannot legitimately differ; if a vendor returns a
       -- variant anyway, the first recording wins rather than the last one
       -- silently rewriting history.
       updated_at = now()`,
    [orgId, hash, first.platform, first.advertiserId, firstSeen, lastSeen,
     group.length, first.bodyText, first.headline, first.cta, first.destinationUrl,
     first.destinationDomain, first.mediaKind, first.mediaUrl,
     JSON.stringify(placements), JSON.stringify(platforms)]
  );
}

/* watchListFor(db, orgId, platform) → external advertiser ids

   An EMPTY watch-list returns null, not an empty array, and null means "pull
   everything the vendor offers". An empty array passed to the adapter would
   filter every row out and the first pull on a fresh install would silently
   collect nothing — which looks exactly like a working job. */
export async function watchListFor(db, orgId, platform) {
  const { rows } = await db.query(
    `SELECT external_advertiser_id FROM ad_watch_advertisers
      WHERE org_id = $1 AND platform = $2 AND active`,
    [orgId, platform]
  );
  return rows.length ? rows.map((r) => r.external_advertiser_id) : null;
}

/* markDormant — a watched advertiser with no observation in `days` is marked
   dormant, never deleted. The disappearance IS the death-watch signal, and a
   deleted row cannot be observed to have disappeared. */
export async function markDormant(db, orgId, { days = 21, asOf = null } = {}) {
  const { rowCount } = await db.query(
    `UPDATE ad_watch_advertisers w
        SET dormant_at = now()
      WHERE w.org_id = $1
        AND w.active
        AND w.dormant_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ad_library_records r
           WHERE r.org_id = w.org_id
             AND r.platform = w.platform
             AND r.advertiser_id = w.external_advertiser_id
             AND r.observed_on > (coalesce($3::date, current_date) - ($2::int))
        )`,
    [orgId, days, asOf]
  );
  return { markedDormant: rowCount };
}
