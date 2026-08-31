// LAYER 2 — the Winner Score, and the honest way to present it.
//
// docs/specs/W2-creative-intelligence.md §7.4.
//
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 IS A RANK AND A BAND, NEVER A DECIMAL
//
// The weights below are a GUESS. They stay a guess until Layer 3 has real
// closes to fit against, and FundHub's own projection files record zero measured
// paid closes today. So the number is computed, stored for the eventual refit,
// and NOT shown. What a subscriber sees is a position and one of three bands.
//
// A number with two decimal places implies a precision that does not exist, and
// the owner cannot audit a figure that was invented. A rank is a claim we can
// actually defend: "this ad has run longer and been pushed harder than that
// one." That claim is true regardless of whether the weights are optimal.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// PERCENTILE WITHIN ANGLE, NOT ACROSS THE BOARD
//
// case_study_receipt ads naturally run long. Normalised across the whole board
// they would occupy the entire top of the list forever, and the board would say
// the same thing every week — which is the fastest way to make a weekly product
// worthless. Each signal is therefore ranked against creatives sharing its
// ANGLE, so "long-running for a case-study ad" and "long-running for a
// debt-rescue ad" are different bars.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// NULL SURVIVES, AND THIS IS WHERE IT MATTERS MOST
//
// A creative with no TikTok data gets NULL for that signal. The score is then
// computed over the signals that DO exist, with the remaining weights
// renormalised so they still sum to 1. Defaulting the missing signal to 0 would
// penalise every creative that is not on TikTok for not being on TikTok, and
// since most are not on TikTok, the board would become a TikTok ranking by
// accident. CLAUDE.md §12: NULL means unknown and must survive.
//
// A creative with NO scorable signal at all gets a null score, a null rank and a
// null band. It appears on no list. That is correct — there is nothing to say
// about it yet.

/* WEIGHTS_VERSION is stored on every signals row. Change a weight, bump this,
   and last month's rows still record which weights produced them. Without it a
   refit would silently restate history, which is the same failure
   partner_revenue.share_pct_applied exists to prevent. */
export const WEIGHTS_VERSION = 1;

/* Assumption A9 in the spec: hand-set, changeable in one object, refit in
   phase 2 against real closes. The percentages are the spec's table verbatim. */
export const WEIGHTS = Object.freeze({
  ad_age_days: 30,          // Longevity — the closest thing to spend evidence available
  variant_count: 20,        // Scaling behaviour
  relaunch_count: 15,       // Resurrection is a strong revealed preference
  placement_spread: 10,     // Advertiser confidence
  cross_platform_echo: 10,  // Market-level rather than algorithm-level
  creative_velocity: 10,    // Testing intensity
  tiktok_perf_bucket: 5     // The only real performance signal available, and it is ordinal
});

export const SCORED_SIGNALS = Object.freeze(Object.keys(WEIGHTS));

/* Band cut points, as a share of the ranked population. Assumption, not
   owner-set: hot is the top fifth, warm the next third, cold the rest. Named
   here so changing them is one edit and so the screen and the API cannot
   disagree about what "hot" means. */
export const BAND_CUTS = Object.freeze({ hot: 0.20, warm: 0.50 });

/* TikTok's ordinal bucket, mapped to a position on the unit interval so it can
   participate in a weighted sum. This is a RANK MAPPING, not a rate: high is
   above medium is above low, and nothing here claims high means any particular
   click-through rate. There is no way to turn a bucket into a number and this
   does not pretend otherwise. */
const BUCKET_POSITION = { high: 1, medium: 0.5, low: 0 };

function numericValue(key, raw) {
  if (raw === null || raw === undefined) return null;
  if (key === "tiktok_perf_bucket") {
    const pos = BUCKET_POSITION[String(raw).toLowerCase()];
    return pos === undefined ? null : pos;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/* percentileTable — for one angle group and one signal, the percentile of each
   value among the non-null values in that group.

   TIES SHARE A PERCENTILE. Using the midpoint of the tied block rather than a
   first-come position means two creatives with identical evidence get identical
   scores, which is what someone comparing them would expect.

   A GROUP OF ONE gets 0.5, not 1.0. A creative alone in its angle has no
   distribution to sit in; giving it the top percentile would put every lone
   creative in a rare angle at the head of the board on the strength of having
   no competition, which is the opposite of what the board is for. */
export function percentileTable(values) {
  const present = values.filter((v) => v !== null && v !== undefined);
  const table = new Map();
  if (!present.length) return table;
  if (present.length === 1) { table.set(present[0], 0.5); return table; }

  const sorted = [...present].sort((a, b) => a - b);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j += 1;
    // Midpoint of the tied block, scaled onto [0, 1].
    const midRank = (i + j) / 2;
    table.set(sorted[i], midRank / (sorted.length - 1));
    i = j + 1;
  }
  return table;
}

/* scoreOne — the weighted sum over the signals that exist.

   Returns null when nothing is scorable. The renormalisation is the whole point:
   weights are divided by the total weight of the signals PRESENT, so a creative
   scored on three signals and one scored on seven are both on a 0-1 scale and
   are comparable. */
export function scoreOne(percentiles) {
  let weighted = 0;
  let weightSum = 0;
  for (const key of SCORED_SIGNALS) {
    const p = percentiles[key];
    if (p === null || p === undefined) continue;
    weighted += p * WEIGHTS[key];
    weightSum += WEIGHTS[key];
  }
  if (weightSum === 0) return null;
  return weighted / weightSum;
}

/* rankWeek(rows) → rows with { winner_score, winner_score_rank, winner_score_band }

   `rows` is one entry per creative: { content_hash, angle, signals }. Angle may
   be null — an unclassified creative is grouped under a bucket of its own so it
   is still ranked against something, rather than being silently dropped or
   silently compared against a classified population it has nothing in common
   with.

   The returned array is sorted by rank, best first, with unscorable creatives
   last and carrying nulls. */
export function rankWeek(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.angle || "__unclassified__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const scored = [];
  for (const group of groups.values()) {
    const tables = {};
    for (const key of SCORED_SIGNALS) {
      tables[key] = percentileTable(group.map((r) => numericValue(key, r.signals?.[key])));
    }
    for (const row of group) {
      const percentiles = {};
      for (const key of SCORED_SIGNALS) {
        const v = numericValue(key, row.signals?.[key]);
        percentiles[key] = v === null ? null : (tables[key].get(v) ?? null);
      }
      scored.push({ ...row, winner_score: scoreOne(percentiles), percentiles });
    }
  }

  // Highest score first. Unscorable creatives sort to the end and keep nulls all
  // the way through — they are not "rank last", they are "not ranked".
  const scorable = scored.filter((r) => r.winner_score !== null)
    .sort((a, b) => b.winner_score - a.winner_score);
  const unscorable = scored.filter((r) => r.winner_score === null);

  const total = scorable.length;
  scorable.forEach((row, i) => {
    row.winner_score_rank = i + 1;
    row.winner_score_band = bandFor(i, total);
  });
  for (const row of unscorable) {
    row.winner_score_rank = null;
    row.winner_score_band = null;
  }

  return [...scorable, ...unscorable];
}

export function bandFor(index, total) {
  if (!total) return null;
  const position = (index + 1) / total;
  if (position <= BAND_CUTS.hot) return "hot";
  if (position <= BAND_CUTS.warm) return "warm";
  return "cold";
}

/* topDecile(rankedRows) → Set of content hashes in the top 10%.

   The death watch reads this from the PREVIOUS week. Kept here rather than in
   signals.mjs so the definition of "top decile" lives with the definition of
   the ranking it is a decile of. */
export function topDecile(rankedRows = []) {
  const scorable = rankedRows.filter((r) => r.winner_score_rank);
  const cut = Math.max(1, Math.ceil(scorable.length * 0.10));
  return new Set(scorable.filter((r) => r.winner_score_rank <= cut).map((r) => r.content_hash));
}
