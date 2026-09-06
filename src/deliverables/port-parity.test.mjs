// THE PORT IS THE POINT. This file proves the Node renderer emits the same
// markup as scripts/black-reports/fundhub_gen.py, character for character,
// except for four differences that are written out below and asserted one by
// one — so a fifth difference appearing later is a test failure, not a surprise.
//
// The golden strings in fixtures/ came out of the Python itself. To recapture
// them after changing fundhub_gen.py:
//
//   python3 - <<'PY'
//   import sys, types, json, pathlib
//   m = types.ModuleType("weasyprint"); m.HTML = object; m.CSS = object
//   sys.modules["weasyprint"] = m
//   sys.path.insert(0, "scripts/black-reports")
//   import fundhub_gen as g
//   pathlib.Path("src/deliverables/fixtures/python-bodies.json").write_text(json.dumps({
//     "credit_analysis": g.build_credit_analysis(g.CLIENT),
//     "funding_snapshot": g.build_funding_snapshot(g.CLIENT),
//     "lender_match": g.build_lender_list(g.CLIENT),
//     "roadmap": g.build_roadmap(g.CLIENT)}, indent=1))
//   PY
//
// WeasyPrint is stubbed because it is not installed here and none of the four
// builders touch it; they return strings.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { box, svgTwoTrack, svgPaydownBars, svgSeverity, svgWaterfall,
  svgScoreRuler, svgShotgun, svgProjection, svgDisputeFlow } from "./charts.mjs";
import { utilBar, table, section } from "./chrome.mjs";
import { buildCreditAnalysis } from "./credit-analysis.mjs";
import { buildFundingSnapshot } from "./funding-snapshot.mjs";
import { buildLenderList } from "./lender-list.mjs";
import { buildRoadmap } from "./roadmap.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8"));

const PY_CHARTS = fixture("python-charts.json");
const PY_BODIES = fixture("python-bodies.json");
const JORDAN = fixture("jordan-sample-client.json");

/**
 * The only formatting difference that is not a content difference: Python's
 * true division makes 60 + 52/2 the float 80.0 and prints "80.0"; JavaScript
 * prints "80". SVG reads both as the same coordinate. Whitespace between tags
 * is likewise collapsed.
 */
function norm(s) {
  return String(s).replace(/(\d)\.0(?=["\s,L])/g, "$1").replace(/\s+/g, " ").trim();
}

describe("port parity — the shared primitives are byte-identical to the Python", () => {
  const cases = [
    ["two_track", () => svgTwoTrack("$7,936", "$19,841")],
    ["paydown", () => svgPaydownBars("$1,762", "$1,573", "$189")],
    ["severity", () => svgSeverity([[1, "SIGNET BANK", "Charge-Off"],
      [2, "CT CHILD SU", "60-Day Lates"], [3, "VT OFFICE", "120+ Day Lates"]])],
    ["waterfall", () => svgWaterfall("$7,936", "+$11,905", "$19,841",
      [["TODAY", "Current pre-approval"], ["UTILIZATION FIX", "Pay down two cards"],
        ["PROJECTED", "After optimization"]])],
    ["ruler", () => svgScoreRuler(636)],
    ["shotgun", () => svgShotgun()],
    ["projection", () => svgProjection(636, "680-710")],
    ["dispute", () => svgDisputeFlow()],
    ["box", () => box(8, 60, 92, 52, [["START", 9, "bold", "#fff"],
      ["DIAGNOSTIC DONE", 5.5, "normal", "#9a9a9a"]], { fill: "#111" })],
    ["util_bar", () => utilBar("SYNCB/LEVITZ", "$1,762 of $1,894", 93)],
    ["table", () => table(["a", "b"], [["1", "2"]], [1])],
    ["section", () => section("01", "bureaus", "Bureau Health Summary")]
  ];
  for (const [name, run] of cases) {
    test(`${name} matches fundhub_gen.py`, () => {
      assert.equal(norm(run()), norm(PY_CHARTS[name]));
    });
  }

  test("all twelve primitives are covered", () => {
    assert.deepEqual(cases.map((c) => c[0]).sort(), Object.keys(PY_CHARTS).sort());
  });
});

/**
 * The four deliberate divergences, applied to the Python's own output so the
 * rest can be compared exactly. Each one is also asserted on its own below.
 */
const DIVERGENCES = Object.freeze({
  // 1. Python title-cases the score key: "transunion".title() -> "Transunion".
  credit_analysis: [["best bureau (Transunion 725)", "best bureau (TransUnion 725)"]],
  // 2. esc() at fundhub_gen.py:236 escapes & < > only, so a creditor name
  //    carrying an ampersand leaves a bare & in the markup. That is not valid
  //    HTML; the house helper escapes it.
  funding_snapshot: [
    ["SHARON & CRESCENT UNIT", "SHARON &amp; CRESCENT UNIT"],
    ["SERVICE & PROF", "SERVICE &amp; PROF"]
  ],
  lender_match: [["BANK & LENDER MATCH LIST", "BANK &amp; LENDER MATCH LIST"]],
  roadmap: [
    // 3. the same helper leaves apostrophes bare; &#39; renders identically.
    ["Jordan's 6-Month Business Readiness Roadmap", "Jordan&#39;s 6-Month Business Readiness Roadmap"],
    // 4. the Python heading literal is already "Before &amp; After" and is then
    //    escaped again, so it prints the entity. The designed PDF
    //    (docs/workflows/gold-deliverables-v5/optimization_roadmap.pdf:541)
    //    reads "Before & After Transformation Table".
    ["Before &amp;amp; After", "Before &amp; After"]
  ]
});

/** Apply the listed divergences to the Python's own output, and only those. */
function correctPython(name, html) {
  let out = html;
  for (const [from, to] of DIVERGENCES[name] || []) {
    assert.ok(out.includes(from), `python output no longer contains ${JSON.stringify(from)}`);
    out = out.split(from).join(to);
  }
  return out;
}

describe("port parity — the four document bodies", () => {
  const builders = {
    credit_analysis: buildCreditAnalysis,
    funding_snapshot: buildFundingSnapshot,
    lender_match: buildLenderList,
    roadmap: buildRoadmap
  };
  for (const [name, build] of Object.entries(builders)) {
    test(`${name} matches fundhub_gen.py for the Jordan Sample client`, () => {
      assert.equal(norm(build(JORDAN)), norm(correctPython(name, PY_BODIES[name])));
    });
  }

  test("all four documents are covered", () => {
    assert.deepEqual(Object.keys(builders).sort(), Object.keys(PY_BODIES).sort());
  });
});

describe("port parity — the four divergences, stated out loud", () => {
  test("1. the bureau is TransUnion, not Transunion", () => {
    const html = buildCreditAnalysis(JORDAN);
    assert.ok(html.includes("(TransUnion 725)"), "brand-cased bureau name");
    assert.ok(!/\bTransunion\b/.test(html), "no title-cased Transunion survives");
    assert.ok(PY_BODIES.credit_analysis.includes("(Transunion 725)"),
      "the Python really does print Transunion");
  });

  test("2. a bare ampersand in client data becomes &amp;", () => {
    const html = buildFundingSnapshot(JORDAN);
    assert.ok(html.includes("SHARON &amp; CRESCENT UNIT"));
    assert.ok(!/&(?!(?:amp|lt|gt|quot|#39);)/.test(html), "no unescaped & anywhere");
  });

  test("3. an apostrophe becomes &#39;, which renders as an apostrophe", () => {
    assert.ok(buildRoadmap(JORDAN).includes("Jordan&#39;s 6-Month Business Readiness Roadmap"));
  });

  test("4. the transformation heading reads Before & After, not Before &amp; After", () => {
    const html = buildRoadmap(JORDAN);
    assert.ok(html.includes("<h2>Before &amp; After Transformation Table</h2>"));
    assert.ok(!html.includes("&amp;amp;"), "the double escape is gone");
    assert.ok(PY_BODIES.roadmap.includes("Before &amp;amp; After"),
      "the Python really does double-escape it");
  });
});
