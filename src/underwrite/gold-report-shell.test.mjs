import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const {
  contentToNodes,
  renderDocumentPDF,
  DRAW_QR_HERE,
  stampedOutcome
} = require("../../vendor/underwriteiq-full/api/lite/crs/render-pdf.js");
import { PDFDocument, StandardFonts } from "pdf-lib";

const {
  tryFhChart,
  prepareGoldNodes,
  goldDocToNodes,
  loadFhCharts,
  renderGoldDocument,
  renderGoldNode
} = require("../../vendor/underwriteiq-full/api/lite/crs/gold-report-shell.js");

function extractPdfText(pdfBuf) {
  const latin1 = Buffer.from(pdfBuf).toString("latin1");
  const chunks = [];
  let pos = 0;
  while (true) {
    const si = latin1.indexOf("stream\n", pos);
    if (si === -1) break;
    const ei = latin1.indexOf("endstream", si);
    if (ei === -1) break;
    const streamBuf = Buffer.from(latin1.slice(si + 7, ei), "latin1");
    let decoded = "";
    try {
      decoded = zlib.inflateSync(streamBuf).toString("latin1");
    } catch {
      decoded = streamBuf.toString("latin1");
    }
    const hexRe = /<([0-9A-Fa-f]+)>\s*T[jJ]/g;
    let m;
    while ((m = hexRe.exec(decoded)) !== null) {
      try {
        chunks.push(Buffer.from(m[1], "hex").toString("latin1"));
      } catch {
        /* skip */
      }
    }
    const litRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
    while ((m = litRe.exec(decoded)) !== null) {
      chunks.push(
        m[0]
          .replace(/\)\s*Tj$/, "")
          .slice(1)
          .replace(/\\n/g, "\n")
          .replace(/\\(.)/g, "$1")
      );
    }
    pos = ei + 9;
  }
  return chunks.join(" ");
}

const sampleMarkdown = `Jordan's file has a clean bureau and a dirty one.

## 01 / PICTURE — Where this file stands

TransUnion is clean. Experian needs work.

## 02 / SCORES — Three bureaus, not one

| Bureau | Score | Status |
| TransUnion | 725 | CLEAN |
| Experian | 630 | DIRTY |

> You can fund on the clean bureau now.

## 03 / UTILIZATION — What is eating the file

SYNCB is 93% full.

## 08 / BOTTOM LINE — Current vs projected

**$7,936** Current pre-approval
`;

const engine = {
  outcome: "FULL_FUNDING",
  consumerSignals: {
    scores: { median: 660, perBureau: { tu: 725, ex: 630, eq: 636 } },
    bureauNegatives: {
      transunion: { pulled: true, clean: true, count: 0 },
      experian: { pulled: true, clean: false, count: 1 },
      equifax: { pulled: true, clean: false, count: 7 }
    },
    anyBureauClean: true
  },
  preapprovals: { total: 7936 },
  projectedPreapproval: { total: 19841 },
  normalized: { tradelines: [] }
};

test("contentToNodes keeps using JSON sections and never dumps them", () => {
  const raw =
    "```json\n" +
    JSON.stringify({
      sections: [
        { type: "heading", content: "Bureau Health Summary" },
        { type: "paragraph", content: "TransUnion is clean." }
      ]
    }) +
    "\n```";
  const nodes = contentToNodes(raw);
  assert.ok(!nodes.some((n) => n.type === "paragraph" && JSON.stringify(n).includes("sections")));
  assert.equal(nodes[0].type, "h2");
  assert.equal(nodes[0].text, "Bureau Health Summary");
});

test("contentToNodes parses gold t:sec documents", () => {
  const spec = {
    body: [
      { t: "lead", body: "Warm open." },
      {
        t: "sec",
        code: "02",
        tag: "SCORES",
        title: "Three bureaus",
        blocks: [
          { t: "table", headers: ["Bureau", "Status"], rows: [["TransUnion", "CLEAN"]] },
          { t: "callout", v: "crit", body: "Fund the clean file." }
        ]
      }
    ]
  };
  const nodes = goldDocToNodes(spec);
  assert.equal(nodes[0].type, "lead");
  assert.equal(nodes[1].type, "section");
  assert.equal(nodes[1].code, "02");
  assert.equal(nodes[2].type, "table");
  assert.equal(nodes[3].type, "callout");
  const fromFence = contentToNodes("```json\n" + JSON.stringify(spec) + "\n```");
  assert.equal(fromFence[1].type, "section");
});

test("contentToNodes refuses broken JSON instead of printing it", () => {
  const nodes = contentToNodes('```json\n{"heading":"x","paragraph":"y"}\n```');
  assert.equal(nodes[0].type, "callout");
  assert.match(nodes[0].text, /could not be formatted/i);
  assert.ok(!JSON.stringify(nodes).includes("```"));
});

test("stampedOutcome prefers engine.outcome from letter-pack", () => {
  assert.equal(stampedOutcome({ outcome: "FULL_FUNDING", outcomeResult: { outcome: "MANUAL_REVIEW" } }), "FULL_FUNDING");
  assert.equal(stampedOutcome({ outcome_tier: "FULL_FUNDING" }), "FULL_FUNDING");
  assert.equal(
    stampedOutcome({
      outcome: "MANUAL_REVIEW",
      outcomeResult: { outcome: "MANUAL_REVIEW" },
      client: { outcome_tier: "FULL_FUNDING" }
    }),
    "FULL_FUNDING"
  );
  assert.equal(
    stampedOutcome({ outcome: "MANUAL_REVIEW" }, { outcome_tier: "FULL_FUNDING" }),
    "FULL_FUNDING"
  );
  assert.equal(stampedOutcome({ outcomeResult: { outcome: "MANUAL_REVIEW" } }), "MANUAL_REVIEW");
  assert.equal(
    stampedOutcome({ outcome: "MANUAL_REVIEW", outcome_tier: "FULL_FUNDING" }),
    "FULL_FUNDING"
  );
});

test("engine.outcome_tier FULL_FUNDING wins over body text that says MANUAL_REVIEW", async () => {
  const md = "## Picture\n\nThis note mentions MANUAL_REVIEW by mistake.\n";
  const buf = await renderDocumentPDF(md, "credit_analysis", { name: "Jordan Sample" }, {
    ...engine,
    outcome: "MANUAL_REVIEW",
    outcome_tier: "FULL_FUNDING"
  });
  const text = extractPdfText(buf);
  assert.match(text, /FULL_FUNDING/);
  assert.ok(
    text.indexOf("FULL_FUNDING") < text.indexOf("MANUAL_REVIEW") || !/MANUAL_REVIEW/.test(text),
    "cover stamp FULL_FUNDING must win over body MANUAL_REVIEW"
  );
});

test("DRAW_QR_HERE is the W4 hook and is a function", () => {
  assert.equal(typeof DRAW_QR_HERE, "function");
});

test("chart stub no-ops when fh-charts is missing", () => {
  assert.equal(tryFhChart(null, "score_lineup", [[{}]]), null);
  assert.equal(tryFhChart({}, "score_lineup", [[{}]]), null);
});

test("shouldDrawChart suppresses waterfall/money_chain before chart call", async () => {
  const charts = await loadFhCharts();
  assert.ok(charts && typeof charts.shouldDrawChart === "function");
  let called = 0;
  const spy = {
    ...charts,
    waterfall(...a) {
      called += 1;
      return charts.waterfall(...a);
    },
    money_chain(...a) {
      called += 1;
      return charts.money_chain(...a);
    }
  };
  assert.equal(tryFhChart(spy, "waterfall", { current: 8000, projected: 5000 }), null);
  assert.equal(tryFhChart(spy, "money_chain", { current: 8000, projected: 5000 }), null);
  assert.equal(called, 0);
  const good = [
    [
      ["Now", "current", 7936, "base"],
      ["After", "gain", 11905, "gain"],
      ["Month 6", "total", 19841, "total"]
    ]
  ];
  const svg = tryFhChart(spy, "waterfall", good);
  assert.ok(svg && svg.includes("<svg"));
  assert.equal(called, 1);
});

test("suppressed empty-string chart does not paint", async () => {
  const charts = await loadFhCharts();
  let drew = 0;
  let chartCalls = 0;
  const spy = {
    waterfall() {
      chartCalls += 1;
      return "";
    },
    shouldDrawChart: charts.shouldDrawChart,
    drawChart() {
      drew += 1;
    },
    unwrapChart: charts.unwrapChart
  };

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);
  const monoBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const page = pdfDoc.addPage([612, 792]);
  const ctx = {
    doc: pdfDoc,
    pages: [page],
    currentPage: page,
    font,
    bold,
    mono,
    monoBold,
    y: 700,
    charts: spy,
    clientName: "Jordan",
    footerTitle: "Funding Snapshot",
    closingPage: null
  };

  // Gain gate: projected <= current → chart fn never called, never painted.
  renderGoldNode(ctx, {
    type: "chart",
    name: "waterfall",
    args: [[["Now", "x", 8000, "base"], ["End", "z", 5000, "total"]]],
    gain: { current: 8000, projected: 5000 }
  });
  assert.equal(chartCalls, 0);
  assert.equal(drew, 0);

  // Empty-string SVG (CHART_SUPPRESSED) with gate open → still no paint.
  spy.shouldDrawChart = () => true;
  renderGoldNode(ctx, {
    type: "chart",
    name: "waterfall",
    args: [[["Now", "x", 1, "base"], ["End", "z", 2, "total"]]]
  });
  assert.equal(chartCalls, 1);
  assert.equal(drew, 0);
});

test("injectChartSlots skips money_chain/waterfall when projected <= current", () => {
  const snap = prepareGoldNodes(
    "funding_snapshot",
    [{ type: "section", code: "01", tag: "NUMBERS", title: "Numbers" }],
    { preapprovals: { total: 9000 }, projectedPreapproval: { total: 9000 } }
  );
  assert.ok(!snap.some((n) => n.name === "waterfall"));

  const analysis = prepareGoldNodes(
    "credit_analysis",
    [
      { type: "lead", text: "Open" },
      { type: "section", code: "08", tag: "BOTTOM LINE", title: "Bottom" }
    ],
    { preapprovals: { total: 9000 }, projectedPreapproval: { total: 1000 } }
  );
  assert.ok(!analysis.some((n) => n.name === "money_chain"));
});

test("prepareGoldNodes injects chart slots after gold sections", () => {
  const nodes = contentToNodes(sampleMarkdown);
  const prepared = prepareGoldNodes("credit_analysis", nodes, engine);
  const types = prepared.map((n) => n.type + (n.name ? ":" + n.name : n.code ? n.code : ""));
  assert.ok(types.includes("chart:journey_map"));
  assert.ok(types.includes("chart:score_lineup"));
  assert.ok(types.includes("section") || types.some((t) => t.startsWith("section") || prepared.some((n) => n.code === "02")));
});

test("gold report PDF uses stamped FULL_FUNDING, cover, tables, not JSON wall", async () => {
  const buf = await renderDocumentPDF(sampleMarkdown, "credit_analysis", { name: "Jordan Sample" }, engine);
  assert.equal(Buffer.from(buf).subarray(0, 4).toString(), "%PDF");
  const text = extractPdfText(buf);
  assert.match(text, /FULL_FUNDING/);
  assert.match(text, /fundhub/i);
  assert.match(text, /Jordan Sample/);
  assert.match(text, /SCORES/);
  assert.match(text, /CLEAN/);
  assert.match(text.replace(/ /g, ""), /MIDDLESCORE/);
  assert.doesNotMatch(text, /MANUAL_REVIEW/);
  assert.doesNotMatch(text, /\[ QR CODE \]/);
  assert.doesNotMatch(text, /```/);
  assert.doesNotMatch(text, /"sections"/);
});

test("JSON fenced Claude output does not appear as body text in the PDF", async () => {
  const raw =
    "```json\n" +
    JSON.stringify({
      body: [
        { t: "lead", body: "Lead sentence about the file." },
        {
          t: "sec",
          code: "02",
          tag: "SCORES",
          title: "Three bureaus",
          blocks: [{ t: "paragraph", body: "TransUnion is the clean bureau." }]
        }
      ]
    }) +
    "\n```";
  const buf = await renderDocumentPDF(raw, "credit_analysis", { name: "Chris Full" }, engine);
  const text = extractPdfText(buf);
  assert.match(text, /FULL_FUNDING/);
  assert.match(text, /TransUnion is the clean bureau/);
  assert.doesNotMatch(text, /```json/);
  assert.doesNotMatch(text, /"t": "sec"/);
});

test("loadFhCharts exposes drawChart and unwrapChart", async () => {
  const charts = await loadFhCharts();
  assert.ok(charts);
  assert.equal(typeof charts.drawChart, "function");
  assert.equal(typeof charts.unwrapChart, "function");
  assert.equal(typeof charts.score_lineup, "function");
});

test("DIAGRAM_SPEC suppress rules skip charts that would lie", () => {
  const snap = prepareGoldNodes(
    "funding_snapshot",
    [{ type: "section", code: "01", tag: "NUMBERS", title: "Current vs projected" }],
    { preapprovals: { total: 8000 }, projectedPreapproval: { total: 5000 } }
  );
  assert.ok(!snap.some((n) => n.name === "waterfall"));

  const analysis = prepareGoldNodes("credit_analysis", contentToNodes(sampleMarkdown), {
    ...engine,
    normalized: { tradelines: [] },
    projectedPreapproval: { total: 1000 }
  });
  assert.ok(!analysis.some((n) => n.name === "utilization_tank"));
  assert.ok(!analysis.some((n) => n.name === "utilization_bars"));
  assert.ok(!analysis.some((n) => n.name === "severity_scale"));
  assert.ok(!analysis.some((n) => n.name === "money_chain"));

  const road = prepareGoldNodes(
    "roadmap",
    [
      { type: "section", code: "01", tag: "PROJECTION", title: "Month 6" },
      { type: "section", code: "03", tag: "MONTHS 2-3", title: "Results" }
    ],
    engine
  );
  assert.ok(!road.some((n) => n.name === "timeline"));
  assert.ok(road.some((n) => n.name === "dispute_clock"));
});

test("live engine totalCombined still drives journey_map and waterfall", () => {
  const live = {
    consumerSignals: { scores: { median: 660, perBureau: { tu: 725, ex: 630, eq: 636 } }, anyBureauClean: true },
    preapprovals: { totalCombined: 7936 },
    projectedPreapproval: { totalCombined: 19841 }
  };
  const analysis = prepareGoldNodes("credit_analysis", contentToNodes(sampleMarkdown), live);
  assert.ok(analysis.some((n) => n.name === "journey_map"));
  const snap = prepareGoldNodes(
    "funding_snapshot",
    [{ type: "section", code: "01", tag: "NUMBERS", title: "Numbers" }],
    live
  );
  assert.ok(snap.some((n) => n.name === "waterfall"));
});

test("lender_match injects unlock_ladder and application_order from matches", () => {
  const lenderEngine = {
    outcome: "FULL_FUNDING",
    consumerSignals: { scores: { median: 636 } },
    lenderMatches: {
      availableNow: [{ name: "Navy Federal", minScore: 650 }],
      afterOptimization: [
        { name: "Kabbage", minScore: 640 },
        { name: "OnDeck", minScore: 660 }
      ]
    },
    normalized: {
      tradelines: [
        {
          isAU: false,
          accountType: "revolving",
          status: "open",
          effectiveLimit: 1894,
          currentBalance: 1762,
          creditorName: "SYNCB/LEVITZ"
        }
      ]
    }
  };
  const prepared = prepareGoldNodes(
    "lender_match",
    [
      { type: "section", code: "01", tag: "AVAILABLE NOW", title: "Matched now" },
      { type: "section", code: "03", tag: "APPLICATION ORDER", title: "Order" }
    ],
    lenderEngine
  );
  assert.ok(prepared.some((n) => n.name === "unlock_ladder"));
  assert.ok(prepared.some((n) => n.name === "application_order"));

  const empty = prepareGoldNodes(
    "lender_match",
    [{ type: "section", code: "01", tag: "AVAILABLE NOW", title: "Matched now" }],
    {
      consumerSignals: { scores: { median: 636 } },
      lenderMatches: { availableNow: [], afterOptimization: [] }
    }
  );
  assert.ok(!empty.some((n) => n.name === "unlock_ladder"));
});

test("timeline injects only when a month-6 range is stated", () => {
  const prepared = prepareGoldNodes(
    "roadmap",
    [{ type: "section", code: "01", tag: "PROJECTION", title: "Month 6" }],
    {
      consumerSignals: { scores: { median: 636 } },
      projectedScoreRange: { lo: 650, hi: 680 }
    }
  );
  const slot = prepared.find((n) => n.name === "timeline");
  assert.ok(slot);
  assert.equal(slot.args[0].length, 6);
  assert.equal(slot.args[1], 636);
  assert.equal(slot.args[2], 650);
});

test("cover uses personal.outcome_tier when engine was downgraded to MANUAL_REVIEW", async () => {
  const buf = await renderDocumentPDF(
    sampleMarkdown,
    "credit_analysis",
    { name: "Jordan Sample", outcome_tier: "FULL_FUNDING" },
    { ...engine, outcome: "MANUAL_REVIEW", outcomeResult: { outcome: "MANUAL_REVIEW" } }
  );
  const text = extractPdfText(buf);
  assert.match(text, /FULL_FUNDING/);
  assert.doesNotMatch(text, /MANUAL_REVIEW/);
});

test("chart that will not fit page-breaks via ensureSpace", async () => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);
  const monoBold = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const nodes = [];
  for (let i = 0; i < 42; i++) {
    nodes.push({
      type: "paragraph",
      runs: [{ text: "Filler line " + i + " keeps the first body page busy so the chart must break." }]
    });
  }
  nodes.push({ type: "section", code: "02", tag: "SCORES", title: "Three bureaus, not one" });
  const ctx = await renderGoldDocument(pdfDoc, {
    type: "credit_analysis",
    personal: { name: "Jordan Sample" },
    engineData: engine,
    nodes,
    fonts: { font, bold, mono, monoBold }
  });
  assert.ok(ctx.pages.length >= 4, "cover + overflow body + closing");
  const buf = Buffer.from(await pdfDoc.save());
  const text = extractPdfText(buf);
  assert.match(text.replace(/ /g, ""), /MIDDLESCORE/);
  assert.doesNotMatch(text, /\[ QR CODE \]/);
});

test("lender match PDF paints unlock ladder and application order", async () => {
  const md = `## 01 / AVAILABLE NOW — Matched now

Navy Federal is in range after the score work.

## 03 / APPLICATION ORDER — Lowest floor first

Do not shotgun.
`;
  const buf = await renderDocumentPDF(
    md,
    "lender_match",
    { name: "Jordan Sample" },
    {
      outcome: "FULL_FUNDING",
      consumerSignals: { scores: { median: 636 } },
      lenderMatches: {
        availableNow: [{ name: "Navy Federal", minScore: 650 }],
        afterOptimization: [{ name: "OnDeck", minScore: 660 }]
      },
      normalized: {
        tradelines: [
          {
            isAU: false,
            accountType: "revolving",
            status: "open",
            effectiveLimit: 1894,
            currentBalance: 1762,
            creditorName: "SYNCB/LEVITZ"
          }
        ]
      }
    }
  );
  const text = extractPdfText(buf);
  assert.match(text, /FULL_FUNDING/);
  assert.match(text.replace(/ /g, ""), /YOURMEDIANSCORE/);
  assert.match(text.replace(/ /g, ""), /THESHOTGUN/);
  assert.match(text, /fundhub/i);
  assert.doesNotMatch(text, /\[ QR CODE \]/);
});
