// LAYER 2 — the ten derived signals. This is the product.
//
// docs/specs/W2-creative-intelligence.md §7.3.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THESE ARE PURE FUNCTIONS OVER AN OBSERVATION LIST
//
// Every one of them is a question about a SEQUENCE. "How old is this ad",
// "did it come back", "has it gone dark", "is this advertiser new" — none of
// these can be answered by looking at a row. They are answered by looking at
// the shape of a series of rows over time, which is exactly why
// ad_library_records is append-only.
//
// Keeping them pure and out of SQL is deliberate. The arithmetic here is the
// thing being sold; a bug in it is a wrong answer on a screen a customer pays
// for, and a set of pure functions over an in-memory list can be tested against
// hand-built sequences with no database at all. The SQL that feeds them lives in
// weekly.mjs and does one job: fetch.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// NULL MEANS UNKNOWN, AND EVERY FUNCTION HERE HONOURS IT
//
// CLAUDE.md §12. A signal that cannot be computed returns null, never 0.
//
//   ad age 0            "we saw it once, today"          — a measurement
//   ad age null         "we have no observation of it"   — an absence
//   placement spread 0  impossible; a creative was observed somewhere
//   variant count null  "we have not classified it yet"  — not "it has no variants"
//
// The Winner Score renormalises over the signals that exist. Defaulting a
// missing signal to 0 would push every unclassified creative to the bottom of
// the board and call it a ranking.

const DAY_MS = 86_400_000;

/* The two windows the spec names. Both are 14 days, and both are here as named
   constants rather than the number 14 written in four places — they are the same
   idea (an ad platform's own reporting lag plus a weekend is comfortably under a
   fortnight) and if one moves they all should. */
export const RELAUNCH_GAP_DAYS = 14;
export const DEATH_WATCH_DAYS = 14;
export const ECHO_WINDOW_DAYS = 14;
export const VELOCITY_WINDOW_WEEKS = 4;

const toDay = (v) => {
  if (!v) return null;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(`${s.slice(0, 10)}T00:00:00.000Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/* ---------------------------------------------------------------------------
   1. AD AGE — days between the first sighting and the most recent one.

   The strongest single proxy available. Nobody publishes competitor spend, but
   an ad that has run for 90 days is running because it makes money, and that is
   evidence rather than an inference dressed up as a number.

   The vendor's own first_seen_at is used when it is EARLIER than our first
   observation, because the ad existed before we started watching and pretending
   otherwise would reset every ad's age to the day the watch-list was created.
   --------------------------------------------------------------------------- */
export function adAgeDays(observations = []) {
  if (!observations.length) return null;
  const days = observations.map((o) => toDay(o.observed_on)).filter(Boolean);
  if (!days.length) return null;
  const vendorFirsts = observations.map((o) => toDay(o.first_seen_at)).filter(Boolean);
  const first = [...days, ...vendorFirsts].sort((a, b) => a - b)[0];
  const last = days.sort((a, b) => a - b).slice(-1)[0];
  return Math.max(0, daysBetween(first, last));
}

/* ---------------------------------------------------------------------------
   2. VARIANT COUNT — distinct creatives sharing advertiser + angle + domain.

   Ten variants of one hook means the advertiser found something and is scaling
   it. Requires classification, so it is NULL for an unclassified creative —
   "we have not looked yet" is not "it stands alone".
   --------------------------------------------------------------------------- */
export function variantCount(hash, index) {
  const self = index.creatives.get(hash);
  if (!self) return null;
  const angle = index.angleOf.get(hash);
  if (!angle) return null;
  const key = `${self.advertiser_id}|${angle}|${self.destination_domain || ""}`;
  const siblings = index.byVariantKey.get(key);
  return siblings ? siblings.size : null;
}

/* ---------------------------------------------------------------------------
   3. RE-LAUNCH — went dark for 14+ days and came back.

   Advertisers only resurrect winners. Counted rather than flagged, because
   twice-resurrected is a stronger statement than once.

   THE GAP IS MEASURED BETWEEN CONSECUTIVE OBSERVATIONS, which is only sound
   because the pull cadence is weekly and fixed (§6.6). If the cadence ever
   becomes irregular this function starts reporting a missed pull as a
   re-launch, and that would be a change to make deliberately, not to discover.
   --------------------------------------------------------------------------- */
export function relaunchCount(observations = []) {
  const days = observations.map((o) => toDay(o.observed_on)).filter(Boolean)
    .sort((a, b) => a - b);
  if (days.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < days.length; i++) {
    if (daysBetween(days[i - 1], days[i]) >= RELAUNCH_GAP_DAYS) count += 1;
  }
  return count;
}

/* ---------------------------------------------------------------------------
   4. CREATIVE VELOCITY — new distinct creatives per advertiser per week,
   averaged over a 4-week rolling window.

   Rising velocity means they are in testing. Flat and old means they are in
   harvest. Both are useful and they mean opposite things, which is why the
   number is kept rather than turned into a flag.
   --------------------------------------------------------------------------- */
export function creativeVelocity(advertiserId, index, asOf) {
  const firsts = index.advertiserFirstSeen.get(advertiserId);
  if (!firsts || !firsts.length) return null;
  const end = toDay(asOf);
  if (!end) return null;
  const start = new Date(end.getTime() - VELOCITY_WINDOW_WEEKS * 7 * DAY_MS);
  const fresh = firsts.filter((d) => d > start && d <= end).length;
  return Number((fresh / VELOCITY_WINDOW_WEEKS).toFixed(3));
}

/* ---------------------------------------------------------------------------
   5. PLACEMENT SPREAD — how many distinct placements the creative ran in.

   Broad spread means the advertiser trusts it enough to let it run everywhere.
   Returns null when no observation carried placement data at all: a vendor that
   does not report placements has told us nothing, and 0 would read as "this ad
   ran nowhere", which is impossible for a row that exists.
   --------------------------------------------------------------------------- */
export function placementSpread(observations = []) {
  const set = new Set();
  let sawAny = false;
  for (const o of observations) {
    const list = Array.isArray(o.placements) ? o.placements : [];
    if (list.length) sawAny = true;
    for (const p of list) set.add(String(p));
  }
  return sawAny ? set.size : null;
}

/* ---------------------------------------------------------------------------
   6. LANDING-PAGE CHANGE — the destination moved during the creative's life.

   A funnel that changed right after a creative scaled is the tell that the
   OFFER changed, not the ad. URLs arrive already stripped of tracking
   parameters (hash.mjs), so a fresh click id is not a change.

   Returns null when fewer than two observations carried a destination — one
   sighting cannot have changed, and saying "false" would assert stability we
   have not observed.
   --------------------------------------------------------------------------- */
export function landingPageChanged(observations = []) {
  const urls = observations.map((o) => o.destination_url).filter(Boolean);
  if (urls.length < 2) return null;
  return new Set(urls).size > 1;
}

/* ---------------------------------------------------------------------------
   7. OFFER / PRICE EXTRACTION — the dollar figure, the term, the guarantee.

   This is what turns "here is a competitor ad" into "here is what the market is
   charging". Returns integer cents (CLAUDE.md §12) and null when no figure is
   present — most brand ads name no price and that is a fact about the ad.

   THE LARGEST FIGURE WINS, not the first. Funding copy routinely reads "$10k to
   $2M"; the headline number the market is anchored on is the ceiling, and
   taking the first match would record every one of those ads as a $10,000
   offer.
   --------------------------------------------------------------------------- */
const MONEY_RE = /\$\s?([\d,]+(?:\.\d{1,2})?)\s*([kmb])?\b/gi;
const MULTIPLIER = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

export function extractOffer(text) {
  const body = String(text || "");
  let priceCents = null;
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(body)) !== null) {
    const base = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const scaled = base * (m[2] ? MULTIPLIER[m[2].toLowerCase()] : 1);
    // Cents by integer arithmetic on the scaled dollars. Deliberately not
    // toCents(): amounts like $2B overflow its MAX_CENTS guard, and a competitor
    // quoting an absurd figure is data about the competitor, not an error in
    // our arithmetic.
    const cents = Math.round(scaled * 100);
    if (priceCents === null || cents > priceCents) priceCents = cents;
  }

  const term = matchFirst(body, [
    /\b(\d+)\s*(?:business\s*)?(hours?|days?|weeks?|months?)\b/i,
    /\b(same[- ]day|next[- ]day|overnight)\b/i,
    /\bper\s+(month|week|year)\b/i
  ]);

  const guarantee = /\b(guarantee[ds]?|guaranteed|money[- ]back|risk[- ]free|or (?:it'?s )?free)\b/i
    .test(body);

  return { priceCents, term: term || null, guaranteeLanguage: guarantee };
}

function matchFirst(text, patterns) {
  for (const rx of patterns) {
    const m = rx.exec(text);
    if (m) return m[0].trim().toLowerCase();
  }
  return null;
}

/* ---------------------------------------------------------------------------
   8. NEW-ENTRANT DETECTION — an advertiser id never seen before.

   Early warning that someone new is spending in the vertical. Computed against
   the whole observation history, not against the watch-list: the interesting
   new entrant is precisely the one nobody has added to the watch-list yet.
   --------------------------------------------------------------------------- */
export function isNewEntrant(advertiserId, index, weekStart) {
  const firsts = index.advertiserFirstSeen.get(advertiserId);
  if (!firsts || !firsts.length) return null;
  const earliest = firsts[0];
  const start = toDay(weekStart);
  if (!start) return null;
  return earliest >= start;
}

/* ---------------------------------------------------------------------------
   9. DEATH WATCH — was in the top decile, and has now been unseen for 14+ days.

   THE MOST COMMERCIALLY USEFUL SIGNAL ON THE BOARD, and nobody publishes it,
   because every competing product is a search box over what is live NOW.
   Knowing what stopped working is worth more than knowing what is running.

   Requires last week's ranking, passed in rather than recomputed. A creative
   with no prior ranking returns FALSE, not null: we know it was never in the
   top decile, so we know it is not a death-watch case. That is a measurement.
   --------------------------------------------------------------------------- */
export function deathWatch(hash, observations, { asOf, priorTopDecile }) {
  if (!priorTopDecile || !priorTopDecile.has(hash)) return false;
  const days = observations.map((o) => toDay(o.observed_on)).filter(Boolean).sort((a, b) => a - b);
  if (!days.length) return true;
  const end = toDay(asOf);
  if (!end) return null;
  return daysBetween(days[days.length - 1], end) >= DEATH_WATCH_DAYS;
}

/* ---------------------------------------------------------------------------
   10. CROSS-PLATFORM ECHO — the same angle + promise + domain on 2+ platforms
   inside 14 days.

   A hook that carries across platforms is a hook about the MARKET, not about
   one algorithm. No single-platform tool can compute this. FundHub can, because
   Layer 1 spans four — which is the one genuine structural advantage in the
   whole board and the reason the tenth signal is this rather than something
   easier.

   Returns the platform COUNT, so 1 means "seen on one platform" — a real
   measurement — and null means "not classified yet", because the key needs the
   angle and the promise shape.
   --------------------------------------------------------------------------- */
export function crossPlatformEcho(hash, index, asOf) {
  const key = index.echoKeyOf.get(hash);
  if (!key) return null;
  const members = index.byEchoKey.get(key);
  if (!members) return null;
  const end = toDay(asOf);
  const cutoff = end ? new Date(end.getTime() - ECHO_WINDOW_DAYS * DAY_MS) : null;
  const platforms = new Set();
  for (const otherHash of members) {
    for (const o of index.observationsOf.get(otherHash) || []) {
      const d = toDay(o.observed_on);
      if (cutoff && d && d < cutoff) continue;
      platforms.add(o.platform);
    }
  }
  return platforms.size || null;
}

/* ---------------------------------------------------------------------------
   buildIndex — the one pass over the data that every signal above reads.

   Built once per week rather than per creative: the variant, echo and velocity
   signals are all cross-creative questions, and computing them inside a
   per-creative loop turns a 3,000-creative week into nine million comparisons.

   `classifications` is a Map of hash → { angle, promise_shape }. It is allowed
   to be partial or empty; the signals that need it return null for the hashes
   it does not cover, which is the correct answer for an unclassified creative.
   --------------------------------------------------------------------------- */
export function buildIndex(records = [], creatives = [], classifications = new Map()) {
  const observationsOf = new Map();
  for (const r of records) {
    const list = observationsOf.get(r.content_hash);
    if (list) list.push(r); else observationsOf.set(r.content_hash, [r]);
  }

  const creativeByHash = new Map();
  for (const c of creatives) creativeByHash.set(c.content_hash, c);

  const angleOf = new Map();
  const echoKeyOf = new Map();
  const byVariantKey = new Map();
  const byEchoKey = new Map();

  for (const [hash, cls] of classifications) {
    if (!cls || !cls.angle) continue;
    angleOf.set(hash, cls.angle);
    const creative = creativeByHash.get(hash);
    const domain = (creative && creative.destination_domain) || "";
    const advertiser = (creative && creative.advertiser_id) || "";

    const vkey = `${advertiser}|${cls.angle}|${domain}`;
    if (!byVariantKey.has(vkey)) byVariantKey.set(vkey, new Set());
    byVariantKey.get(vkey).add(hash);

    // The echo key deliberately EXCLUDES the advertiser. Two different
    // advertisers running the same angle to the same domain is a market fact;
    // scoping it per advertiser would only ever find one company syndicating
    // its own ad, which is a much less interesting thing to know.
    const ekey = `${cls.angle}|${cls.promise_shape || ""}|${domain}`;
    echoKeyOf.set(hash, ekey);
    if (!byEchoKey.has(ekey)) byEchoKey.set(ekey, new Set());
    byEchoKey.get(ekey).add(hash);
  }

  // First sighting per advertiser, and the first sighting of each of that
  // advertiser's distinct creatives — velocity counts NEW creatives, so it needs
  // the per-creative firsts, not the per-observation ones.
  const advertiserFirstSeen = new Map();
  const seenCreative = new Set();
  const ordered = [...records].sort((a, b) => String(a.observed_on).localeCompare(String(b.observed_on)));
  for (const r of ordered) {
    const marker = `${r.advertiser_id}|${r.content_hash}`;
    if (seenCreative.has(marker)) continue;
    seenCreative.add(marker);
    const d = toDay(r.observed_on);
    if (!d) continue;
    const list = advertiserFirstSeen.get(r.advertiser_id);
    if (list) list.push(d); else advertiserFirstSeen.set(r.advertiser_id, [d]);
  }
  for (const list of advertiserFirstSeen.values()) list.sort((a, b) => a - b);

  return {
    observationsOf,
    creatives: creativeByHash,
    angleOf,
    echoKeyOf,
    byVariantKey,
    byEchoKey,
    advertiserFirstSeen
  };
}

/* signalsFor(hash, index, { asOf, weekStart, priorTopDecile, tiktokBucket })
     → the ten signals, ready for one ad_creative_signals row. */
export function signalsFor(hash, index, opts = {}) {
  const observations = index.observationsOf.get(hash) || [];
  const creative = index.creatives.get(hash) || {};
  const body = [creative.headline, creative.body_text].filter(Boolean).join("\n");
  const offer = extractOffer(body);

  return {
    ad_age_days: adAgeDays(observations),
    variant_count: variantCount(hash, index),
    relaunch_count: relaunchCount(observations),
    creative_velocity: creativeVelocity(creative.advertiser_id, index, opts.asOf),
    placement_spread: placementSpread(observations),
    landing_page_changed: landingPageChanged(observations),
    offer_price_cents: offer.priceCents,
    offer_term: offer.term,
    new_entrant: isNewEntrant(creative.advertiser_id, index, opts.weekStart),
    death_watch: deathWatch(hash, observations, {
      asOf: opts.asOf, priorTopDecile: opts.priorTopDecile
    }),
    cross_platform_echo: crossPlatformEcho(hash, index, opts.asOf),
    // Ordinal, and it stays ordinal. TikTok publishes high/medium/low and there
    // is no way to turn a bucket into a rate — §16 item 2. Anything that
    // converts this to a number is inventing a measurement.
    tiktok_perf_bucket: opts.tiktokBucket || null,
    guarantee_language: offer.guaranteeLanguage
  };
}
