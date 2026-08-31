// LAYER 2 — the saturation map. Which angles are crowded and which are open.
//
// docs/specs/W2-creative-intelligence.md §7.5.
//
// This is the single screen that turns the board from a swipe file into a
// decision tool. "Nobody in this vertical is running anti_guru_contrarian +
// screen_record_proof + low_ticket_slo" is an actionable sentence. "Here are 400
// ads" is not.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE UNIT OF COUNTING IS DISTINCT ADVERTISERS, NOT ADS
//
// This is the whole design and it is easy to get wrong. One advertiser running
// forty variants of the same hook is ONE competitor, not forty. Counting ads
// would make any single heavy spender look like a crowded market and would send
// a partner running away from a cell that has exactly one occupant.
//
// So every cell holds a SET of advertiser ids and reports its size. The ad count
// is reported alongside, because "one advertiser, forty ads" and "one
// advertiser, one ad" are genuinely different situations — the first is someone
// who found something.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// AN EMPTY CELL IS NOT AUTOMATICALLY AN OPPORTUNITY
//
// Some cells are empty because nobody thought of them. Others are empty because
// the combination does not work, or because a platform bans it — a
// credit-outcome claim in a carousel is empty for a reason. The map reports
// occupancy, and the copy on the screen says openness is a hypothesis rather
// than a finding. Selling an empty cell as a guaranteed opening would be exactly
// the kind of confident invention CLAUDE.md §2 forbids.

import { ANGLES, AD_FORMATS, FUNNELS } from "./taxonomy.mjs";

/* Occupancy thresholds, by distinct advertiser count. Assumption, not
   owner-set — named so the screen and the API cannot disagree, and so moving
   them is one edit. */
export const CROWDING = Object.freeze({
  open: 0,        // nobody
  thin: 2,        // 1-2 advertisers
  contested: 5    // 3-5; above that it is crowded
});

export function crowdingLabel(advertisers) {
  if (advertisers <= CROWDING.open) return "open";
  if (advertisers <= CROWDING.thin) return "thin";
  if (advertisers <= CROWDING.contested) return "contested";
  return "crowded";
}

/* buildSaturation(rows, { includeEmpty })

   `rows` is one entry per LIVE creative in the week:
     { content_hash, advertiser_id, angle, ad_format, funnel }

   Unclassified creatives are skipped — a creative with no angle cannot be placed
   in a cell, and putting it in an "unknown" cell would create a phantom
   competitor in a cell nobody is actually in.

   Returns { cells, angles, totals, generatedAt } where a cell is
     { angle, ad_format, funnel, advertisers, ads, crowding }

   includeEmpty is FALSE by default: the full grid is 10 x 8 x 6 = 480 cells and
   in a normal week well over 400 of them are empty, which is 400 rows of nothing
   travelling to a browser. The screen renders the grid it needs from the angle
   and format lists, which are constants it already has. */
export function buildSaturation(rows = [], { includeEmpty = false } = {}) {
  const cells = new Map();

  for (const row of rows) {
    if (!row || !row.angle || !row.ad_format || !row.funnel) continue;
    const key = `${row.angle}|${row.ad_format}|${row.funnel}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        angle: row.angle, ad_format: row.ad_format, funnel: row.funnel,
        advertiserSet: new Set(), ads: 0
      };
      cells.set(key, cell);
    }
    if (row.advertiser_id) cell.advertiserSet.add(row.advertiser_id);
    cell.ads += 1;
  }

  const out = [];
  for (const cell of cells.values()) {
    out.push({
      angle: cell.angle,
      ad_format: cell.ad_format,
      funnel: cell.funnel,
      advertisers: cell.advertiserSet.size,
      ads: cell.ads,
      crowding: crowdingLabel(cell.advertiserSet.size)
    });
  }

  if (includeEmpty) {
    for (const angle of ANGLES) {
      for (const ad_format of AD_FORMATS) {
        for (const funnel of FUNNELS) {
          if (!cells.has(`${angle}|${ad_format}|${funnel}`)) {
            out.push({ angle, ad_format, funnel, advertisers: 0, ads: 0, crowding: "open" });
          }
        }
      }
    }
  }

  out.sort((a, b) =>
    b.advertisers - a.advertisers ||
    b.ads - a.ads ||
    a.angle.localeCompare(b.angle));

  return {
    cells: out,
    angles: angleTotals(rows),
    totals: {
      occupiedCells: cells.size,
      totalCells: ANGLES.length * AD_FORMATS.length * FUNNELS.length,
      advertisers: new Set(rows.map((r) => r.advertiser_id).filter(Boolean)).size,
      creatives: rows.length
    }
  };
}

/* angleTotals — the row the territory assignment actually reads.

   §8.2 step 1 ranks angles by INVERSE crowding to pick a partner's territory.
   That needs a per-angle advertiser count, not a per-cell one, so it is computed
   here rather than summed from cells by a caller — summing cell advertiser
   counts would double-count an advertiser present in two formats. */
export function angleTotals(rows = []) {
  const byAngle = new Map();
  for (const angle of ANGLES) byAngle.set(angle, { angle, advertiserSet: new Set(), ads: 0 });
  for (const row of rows) {
    if (!row || !row.angle) continue;
    const entry = byAngle.get(row.angle);
    if (!entry) continue;
    if (row.advertiser_id) entry.advertiserSet.add(row.advertiser_id);
    entry.ads += 1;
  }
  return [...byAngle.values()]
    .map((e) => ({
      angle: e.angle,
      advertisers: e.advertiserSet.size,
      ads: e.ads,
      crowding: crowdingLabel(e.advertiserSet.size)
    }))
    .sort((a, b) => a.advertisers - b.advertisers || a.angle.localeCompare(b.angle));
}

/* whitespace(saturation, { limit }) — the least contested angles, best first.

   Exported because this is the exact input §8.2 step 1 needs, and because a
   caller re-deriving "least crowded" from the cells list would get a different
   answer for the double-counting reason above. */
export function whitespace(saturation, { limit = 5 } = {}) {
  return (saturation.angles || []).slice(0, limit);
}
