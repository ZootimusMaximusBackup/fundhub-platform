import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  score_lineup,
  utilization_tank,
  severity_scale,
  money_chain,
  journey_map,
  dispute_clock,
  application_order,
  waterfall,
  unlock_ladder,
  utilization_bars,
  timeline,
  shouldDrawChart,
  CHART_SUPPRESSED
} from "./fh-charts.mjs";
import { unwrapChart, parseChart, drawChart } from "./fh-charts-embed.mjs";

function assertSuppressed(svg, label) {
  assert.equal(svg, CHART_SUPPRESSED, `${label} must suppress (empty sentinel)`);
  assert.equal(svg.includes("NaN"), false, `${label} must not emit NaN`);
}

const SCORE_ROWS = [
  ["TransUnion", 725, "Nothing negative on it"],
  ["Experian", 630, "1 negative item"],
  ["Equifax", 636, "7 negative items"]
];

const TANK = ["SYNCB/LEVITZ", 1894, 1762, 189, 1573];

const SEVERITY = [
  [7, "STUDENT LOANS (x2)", "an error to clean up", 0.04, "a"],
  [1, "SIGNET BANK", "worst item, fix first", 0.96, "a"],
  [3, "OLD CARD", "late pays, still hurting", 0.55, "b"]
];

const CHAIN_STEPS = [
  ["STEP 1", "Pay two cards", "$1,573 + $367"],
  ["WHAT CHANGES", "Cards drop under 10%", "utilization falls from 97%"],
  ["WHAT LENDERS SEE", "Score jumps", "+40 to 80 points"],
  ["WHAT YOU GET", "Pre-approval jumps", "$7,936 becomes $19,841"]
];

const APP_STEPS = [
  ["Fix utilization first", "PAY SYNCB/LEVITZ DOWN TO $189"],
  ["Lowest score floor first", "NAVY FEDERAL AT 650 / KABBAGE AT 640"],
  ["Then the next match", "ONDECK AT 660"],
  ["Pause if a hard pull lands", "DO NOT STACK INQUIRIES"],
  ["Re-check before round two", "FRESH REPORT BEFORE THE NEXT FIVE"]
];

const WATERFALL_STEPS = [
  ["Now", "today", 7936, "base"],
  ["Gain", "after paydown", 11905, "gain"],
  ["Then", "projected", 19841, "total"]
];

const LADDER_TIERS = [
  [650, ["Navy Federal"]],
  [680, ["Kabbage", "OnDeck"]],
  [700, ["A longer lender name that should wrap when the list is wide enough"]]
];

const UTIL_ROWS = [
  ["SYNCB/LEVITZ", 93, "Pay down $1,573 to $189"],
  ["CAPITAL ONE", 41, "Pay down $220 to $80"],
  ["ALL CARDS", 74, "Target 10%"]
];

const MONTHS = [
  [1, "Pay cards", "SYNCB · LEVITZ", null],
  [2, "Round 1", "Send letters", null],
  [3, "Wait", "30 day clock", null],
  [4, "Round 2", "Escalate", null],
  [5, "Round 3", "Finish repair", null],
  [6, "Re-check", "Fresh report", "650-680"]
];

const CHARTS = [
  ["score_lineup", () => score_lineup(SCORE_ROWS), ["YOUR MIDDLE SCORE", "EXPERIAN", "630", "LENDERS PICK THE MIDDLE SCORE"]],
  ["utilization_tank", () => utilization_tank(...TANK), ["TODAY", "THE GOAL", "SYNCB/LEVITZ", "93% FULL", "PAY DOWN"]],
  ["severity_scale", () => severity_scale(SEVERITY), ["HURTS MOST", "SIGNET BANK", "STUDENT LOANS"]],
  [
    "money_chain",
    () => money_chain(CHAIN_STEPS, "Paying the two worst cards pays you back.", "Cause then effect, left to right."),
    ["WHAT YOU GET", "Pre-approval"]
  ],
  ["journey_map", () => journey_map(), ["TRACK 1", "FUND NOW", "$7,936", "$19,841", "RE-CHECK"]],
  ["dispute_clock", () => dispute_clock(), ["Why disputes take rounds", "The 30 day clock", "DELETED = OFF YOUR REPORT"]],
  ["application_order", () => application_order(APP_STEPS), ["THE SHOTGUN", "Fix utilization first", "HARD INQUIRIES"]],
  ["waterfall", () => waterfall(WATERFALL_STEPS), ["$7,936", "+$11,905", "$19,841"]],
  ["unlock_ladder", () => unlock_ladder(636, LADDER_TIERS), ["YOUR MEDIAN SCORE", "+14 PTS", "Navy Federal"]],
  ["utilization_bars", () => utilization_bars(UTIL_ROWS), ["TARGET  10%", "SYNCB/LEVITZ", "93%"]],
  ["timeline", () => timeline(MONTHS, 636, 650, 680), ["TODAY", "PROJECTED", "650-680", "MONTH 1"]]
];

function assertPtAndSvg(svg, name) {
  assert.match(svg, /<div class="chart">/, `${name} wraps in div.chart`);
  assert.match(svg, /<svg width="508pt" /, `${name} svg width in pt`);
  assert.match(svg, /height="\d+pt"/, `${name} svg height in pt`);
  assert.match(svg, /font-family="Inter"/, `${name} Inter names`);
  assert.match(svg, /font-family="JetBrains Mono"/, `${name} JetBrains numbers`);
  assert.match(svg, /#0C0C0D/, `${name} ink`);
}

for (const [name, fn, labels] of CHARTS) {
  test(`${name} is deterministic and labeled`, () => {
    const a = fn();
    const b = fn();
    assert.equal(a, b, `${name} same args → identical SVG`);
    assertPtAndSvg(a, name);
    for (const label of labels) {
      assert.ok(a.includes(label), `${name} missing label ${JSON.stringify(label)}`);
    }
  });
}

test("unlock_ladder marks passed tiers UNLOCKED", () => {
  const svg = unlock_ladder(705, LADDER_TIERS);
  assert.ok(svg.includes("UNLOCKED"));
  assert.equal(svg.includes("+"), false);
});

test("score_lineup sorts so the middle card is the middle score", () => {
  const svg = score_lineup(SCORE_ROWS);
  const exp = svg.indexOf("EXPERIAN");
  const eq = svg.indexOf("EQUIFAX");
  const tu = svg.indexOf("TRANSUNION");
  assert.ok(exp >= 0 && eq > exp && tu > eq);
  assert.ok(svg.includes("Yours is 636."));
});

test("utilization_bars clamps fill at 100% but prints the true percent", () => {
  const svg = utilization_bars([["OVER", 150, "unknown limit excluded"]], 10);
  assert.ok(svg.includes("150%"));
  assert.match(svg, /width="314\.0"/);
  assert.equal(svg.includes("471"), false);
});

test("journey_map suppresses Track 1 when there is no clean bureau", () => {
  const svg = journey_map(null, { hasCleanBureau: false, currentApproval: 0, projectedApproval: 12000 });
  assert.equal(svg.includes("TRACK 1"), false);
  assert.equal(svg.includes("FUND NOW"), false);
  assert.ok(svg.includes("TRACK 2"));
  assert.ok(svg.includes("$12,000"));
  assert.ok(svg.includes("no clean bureau"));
});

test("caption pins extra height in pt and stays stable", () => {
  const a = dispute_clock("Same every client.");
  const b = dispute_clock("Same every client.");
  assert.equal(a, b);
  assert.match(a, /height="\d+pt"/);
  assert.ok(a.includes("Same every client."));
});

test("unwrapChart reads pt box for W3", () => {
  const wrapped = score_lineup(SCORE_ROWS);
  const u = unwrapChart(wrapped);
  assert.equal(u.widthPt, 508);
  assert.ok(u.heightPt > 100);
  assert.ok(u.svg.startsWith("<svg "));
  const parsed = parseChart(wrapped);
  assert.ok(parsed.elements.some((e) => e.tag === "text" && e.text.includes("MIDDLE SCORE")));
  assert.ok(parsed.elements.some((e) => e.tag === "rect"));
});

test("drawChart paints primitives onto a pdf-lib page without a new dep", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);
  const { widthPt, heightPt } = drawChart(page, score_lineup(SCORE_ROWS), {
    x: 52,
    y: 400,
    fonts: { sans: helv, sansBold: helvBold, mono: courier, monoBold: courierBold }
  });
  assert.equal(widthPt, 508);
  assert.ok(heightPt > 100);
  const bytes = await doc.save();
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
});

// ── B4 smash: DIAGRAM_SPEC §6 suppress + bad numbers ───────────────────────

test("score_lineup suppresses NaN / null / missing / empty — no throw, no NaN SVG", () => {
  assertSuppressed(
    score_lineup([
      ["TransUnion", NaN, "x"],
      ["Experian", 630, "y"],
      ["Equifax", 636, "z"]
    ]),
    "NaN score"
  );
  assertSuppressed(
    score_lineup([
      ["TransUnion", null, "x"],
      ["Experian", 630, "y"],
      ["Equifax", 636, "z"]
    ]),
    "null score"
  );
  assertSuppressed(
    score_lineup([
      ["TransUnion", undefined, "x"],
      ["Experian", 630, "y"],
      ["Equifax", 636, "z"]
    ]),
    "missing score"
  );
  assertSuppressed(score_lineup([]), "empty rows");
  assertSuppressed(score_lineup([["Only", 600, "one"]]), "short rows");
  assert.equal(shouldDrawChart("score_lineup", [SCORE_ROWS]), true);
  assert.equal(shouldDrawChart("score_lineup", [[]]), false);
});

test("utilization_tank suppresses limit 0 / negative / non-finite; bal>limit still draws honest %", () => {
  assertSuppressed(utilization_tank("X", 0, 100, 10, 90), "limit 0");
  assertSuppressed(utilization_tank("X", -50, 10, 5, 5), "negative limit");
  assertSuppressed(utilization_tank("X", NaN, 10, 5, 5), "NaN limit");
  const over = utilization_tank("SYNCB", 100, 150, 10, 140);
  assert.match(over, /<div class="chart">/);
  assert.ok(over.includes("150% FULL"));
  assert.equal(over.includes("NaN"), false);
  assert.equal(shouldDrawChart("utilization_tank", ["X", 0, 1, 0, 1]), false);
  assert.equal(shouldDrawChart("utilization_tank", TANK), true);
});

test("empty rows suppress lineup and bars", () => {
  assertSuppressed(utilization_bars([]), "empty bars");
  assert.equal(shouldDrawChart("utilization_bars", [[]]), false);
});

test("waterfall / money_chain suppress when projected <= current (no invented gain)", () => {
  assertSuppressed(
    waterfall([
      ["Now", "today", 8000, "base"],
      ["Then", "projected", 5000, "total"]
    ]),
    "projected < current"
  );
  assertSuppressed(
    waterfall([
      ["Now", "today", 100, "base"],
      ["Then", "flat", 100, "total"]
    ]),
    "projected == current"
  );
  assertSuppressed(waterfall([]), "empty waterfall");
  assertSuppressed(
    waterfall([
      ["Now", "t", 0, "base"],
      ["Then", "p", 0, "total"]
    ]),
    "zero total"
  );
  assert.equal(shouldDrawChart("waterfall", { current: 8000, projected: 5000 }), false);
  assert.equal(shouldDrawChart("waterfall", { current: 7936, projected: 19841 }), true);
  assert.equal(shouldDrawChart("money_chain", { current: 8000, projected: 5000 }), false);
  assert.equal(shouldDrawChart("money_chain", { current: 7936, projected: 19841 }), true);
  assertSuppressed(money_chain([], "h", "t"), "empty money_chain");
  // Happy path still draws a real gain, never invents one from flat numbers.
  const happy = waterfall(WATERFALL_STEPS);
  assert.ok(happy.includes("+$11,905"));
  assert.equal(happy.includes("NaN"), false);
});

test("same args still produce identical SVG on happy path", () => {
  assert.equal(score_lineup(SCORE_ROWS), score_lineup(SCORE_ROWS));
  assert.equal(utilization_tank(...TANK), utilization_tank(...TANK));
  assert.equal(waterfall(WATERFALL_STEPS), waterfall(WATERFALL_STEPS));
  assert.equal(utilization_bars(UTIL_ROWS), utilization_bars(UTIL_ROWS));
});

test("drawChart on malformed SVG does not throw", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const fonts = {
    sans: await doc.embedFont(StandardFonts.Helvetica),
    sansBold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold)
  };
  const malformed =
    '<div class="chart"><svg width="10pt" height="10pt">' +
    '<rect x="bad" y="0" width="1" height="1" fill="#000"/>' +
    '<line x1="NaN" y1="0" x2="1" y2="1" stroke="#000"/>' +
    '<polygon points="garbage"/>' +
    '<path d=""/>' +
    '<text x="0" y="0" font-family="Inter" font-size="8" font-weight="400" fill="#000">ok</text>' +
    "</svg></div>";
  assert.doesNotThrow(() => drawChart(page, malformed, { x: 0, y: 0, fonts }));
  const r = drawChart(page, malformed, { x: 0, y: 0, fonts });
  assert.equal(typeof r.widthPt, "number");
  assert.equal(typeof r.heightPt, "number");
});

test("huge / negative caption and bad scale ranges do not emit NaN", () => {
  const huge = score_lineup(SCORE_ROWS, "x".repeat(5000));
  assert.match(huge, /<div class="chart">/);
  assert.equal(huge.includes("NaN"), false);
  const negCap = score_lineup(SCORE_ROWS, -1);
  assert.match(negCap, /<div class="chart">/);
  assert.ok(negCap.includes("-1"));
  assertSuppressed(utilization_tank("X", -1000000, 1, 0, 1), "huge negative limit");
  const wide = unlock_ladder(636, LADDER_TIERS, 650, 650);
  assert.match(wide, /<div class="chart">/);
  assert.equal(wide.includes("NaN"), false);
  assertSuppressed(unlock_ladder(636, []), "empty lender tiers");
});

test("journey_map hasCleanBureau false — Track 1 must not appear", () => {
  const svg = journey_map(null, { hasCleanBureau: false });
  assert.equal(svg.includes("TRACK 1"), false);
  assert.equal(svg.includes("FUND NOW"), false);
  assert.ok(svg.includes("TRACK 2"));
});
