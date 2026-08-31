// The saturation map.
//
// The property that matters: THE UNIT OF COUNTING IS DISTINCT ADVERTISERS, not
// ads. One advertiser running forty variants is one competitor. Counting ads
// would make any single heavy spender look like a crowded market and would send
// a partner running away from a cell with one occupant in it.

import { test, describe } from "node:test";
import assert from "node:assert";
import { buildSaturation, angleTotals, whitespace, crowdingLabel } from "./saturation.mjs";
import { ANGLES, AD_FORMATS, FUNNELS } from "./taxonomy.mjs";

const cell = (advertiser, angle, ad_format, funnel, hash) =>
  ({ content_hash: hash, advertiser_id: advertiser, angle, ad_format, funnel });

describe("buildSaturation", () => {
  const rows = [
    cell("adv-a", "speed_of_money", "talking_head_ugc", "call_booking", "h1"),
    cell("adv-a", "speed_of_money", "talking_head_ugc", "call_booking", "h2"),
    cell("adv-a", "speed_of_money", "talking_head_ugc", "call_booking", "h3"),
    cell("adv-b", "speed_of_money", "talking_head_ugc", "call_booking", "h4"),
    cell("adv-c", "debt_rescue", "meme_static", "webinar", "h5")
  ];

  test("counts distinct advertisers, not ads", () => {
    const s = buildSaturation(rows);
    const busy = s.cells.find((c) => c.angle === "speed_of_money");
    assert.equal(busy.advertisers, 2, "three ads from one advertiser is one competitor");
    assert.equal(busy.ads, 4);
  });

  test("reports the ad count alongside, because they mean different things", () => {
    // "one advertiser, forty ads" is someone who found something. "one
    // advertiser, one ad" is someone testing. Collapsing them loses that.
    const s = buildSaturation([
      cell("adv-a", "lender_secret", "carousel", "book", "x1"),
      cell("adv-a", "lender_secret", "carousel", "book", "x2")
    ]);
    assert.equal(s.cells[0].advertisers, 1);
    assert.equal(s.cells[0].ads, 2);
  });

  test("unclassified creatives are skipped, not put in an 'unknown' cell", () => {
    // A phantom competitor in a cell nobody is actually in is worse than a gap.
    const s = buildSaturation([...rows, { content_hash: "h9", advertiser_id: "adv-z" }]);
    assert.equal(s.totals.advertisers, 4, "the unclassified advertiser still counts in totals");
    assert.equal(s.cells.reduce((a, c) => a + c.ads, 0), 5);
  });

  test("empty cells are omitted by default and produced on request", () => {
    const lean = buildSaturation(rows);
    const full = buildSaturation(rows, { includeEmpty: true });
    assert.equal(lean.cells.length, 2);
    assert.equal(full.cells.length, ANGLES.length * AD_FORMATS.length * FUNNELS.length);
    assert.equal(full.totals.totalCells, full.cells.length);
  });

  test("cells sort by crowding, busiest first", () => {
    const s = buildSaturation(rows);
    assert.equal(s.cells[0].angle, "speed_of_money");
  });
});

describe("angleTotals — what the territory assignment reads", () => {
  test("an advertiser in two formats is counted once for the angle", () => {
    // Summing the per-cell advertiser counts would double-count them, which is
    // why this is computed here rather than derived by a caller.
    const s = buildSaturation([
      cell("adv-a", "speed_of_money", "talking_head_ugc", "call_booking", "h1"),
      cell("adv-a", "speed_of_money", "meme_static", "call_booking", "h2")
    ]);
    const angle = s.angles.find((a) => a.angle === "speed_of_money");
    assert.equal(angle.advertisers, 1);
    assert.equal(angle.ads, 2);
  });

  test("every angle in the taxonomy appears, including the empty ones", () => {
    // An angle nobody is running is the most interesting row on the map, so it
    // must not be absent just because no creative produced it.
    const totals = angleTotals([]);
    assert.equal(totals.length, ANGLES.length);
    assert.ok(totals.every((t) => t.advertisers === 0 && t.crowding === "open"));
  });

  test("least contested first — that ordering is the whole point", () => {
    const totals = angleTotals([
      cell("adv-a", "speed_of_money", "carousel", "book", "h1"),
      cell("adv-b", "speed_of_money", "carousel", "book", "h2"),
      cell("adv-c", "debt_rescue", "carousel", "book", "h3")
    ]);
    assert.equal(totals[totals.length - 1].angle, "speed_of_money");
    assert.equal(whitespace({ angles: totals }, { limit: 1 })[0].advertisers, 0);
  });
});

describe("crowdingLabel", () => {
  test("open / thin / contested / crowded", () => {
    assert.equal(crowdingLabel(0), "open");
    assert.equal(crowdingLabel(2), "thin");
    assert.equal(crowdingLabel(5), "contested");
    assert.equal(crowdingLabel(6), "crowded");
  });
});
