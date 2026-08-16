import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";

const require = createRequire(import.meta.url);
const {
  generateSummaryDocument,
  generateAllSummaryDocuments,
  generateFundingSummary,
  generateRepairPlanSummary,
  sanitizePdfText
} = require("../../vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js");

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

async function pageCount(buf) {
  const doc = await PDFDocument.load(buf);
  return doc.getPageCount();
}

const mockCRS = {
  ok: true,
  outcome: "FUNDING_PLUS_REPAIR",
  decision_label: "Conditionally Approved",
  consumer_summary: "Credit score: 695. Utilization at 42%.",
  consumerSignals: {
    scores: { median: 695 },
    utilization: { overall: 42 },
    derogatories: { active: 1 }
  },
  preapprovals: {
    totalPersonal: 45000,
    totalBusiness: 15000,
    totalCombined: 60000,
    confidenceBand: "medium"
  },
  optimization_findings: [
    { code: "HIGH_UTIL", category: "utilization", severity: "high", title: "High utilization" }
  ],
  suggestions: { topMoves: [{ title: "Pay down revolving" }] }
};

test("null engine + empty personal: funding emits non-empty %PDF, no throw", async () => {
  const buffer = await generateFundingSummary(null, null);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 100);
  assert.equal(buffer.slice(0, 5).toString(), "%PDF-");
});

test("undefined engine: repair emits non-empty %PDF, no throw", async () => {
  const buffer = await generateRepairPlanSummary(undefined, {});
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 100);
  assert.equal(buffer.slice(0, 5).toString(), "%PDF-");
});

test("generateSummaryDocument null engine still starts with %PDF", async () => {
  for (const type of ["funding_summary", "repair_plan_summary", "issue_priority_sheet", "hold_notice", "operator_checklist", "business_prep_summary"]) {
    const buffer = await generateSummaryDocument(type, null, null);
    assert.equal(buffer.slice(0, 5).toString(), "%PDF-", type);
    assert.ok(buffer.length > 100, type);
  }
});

test("generateAllSummaryDocuments null engine: emits valid PDFs, never 0-byte", async () => {
  const results = await generateAllSummaryDocuments(
    [{ type: "funding_summary" }, { type: "repair_plan_summary" }],
    null,
    null
  );
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.ok(r.buffer.length > 100, r.type);
    assert.equal(r.buffer.slice(0, 5).toString(), "%PDF-", r.type);
  }
});

test("must not print ```json from consumer_summary", async () => {
  const crs = {
    ...mockCRS,
    consumer_summary: 'Leak:\n```json\n{"score":700}\n```\nok'
  };
  const buffer = await generateFundingSummary(crs, { name: "Jordan" });
  const text = extractPdfText(buffer);
  assert.equal(text.includes("```json"), false);
  assert.equal(text.includes('{"score":700}'), false);
  assert.match(text, /Capital Readiness Summary/);
});

test("must not print [ QR CODE ]; funding/repair are 1-page (no close QR page)", async () => {
  const crs = {
    ...mockCRS,
    consumer_summary: "See [ QR CODE ] and [ Q R   C O D E ] for apply"
  };
  const fund = await generateFundingSummary(crs, { name: "Jordan" });
  const repair = await generateRepairPlanSummary(crs, { name: "Jordan" });
  const fundText = extractPdfText(fund);
  const repairText = extractPdfText(repair);
  assert.equal(/\[\s*Q\s*R\s*C\s*O\s*D\s*E\s*\]/i.test(fundText), false);
  assert.equal(/\[\s*QR\s*CODE\s*\]/i.test(fundText), false);
  assert.equal(/\[\s*QR\s*CODE\s*\]/i.test(repairText), false);
  assert.equal(await pageCount(fund), 1, "funding summary is 1-page — no gold close/QR page");
  assert.equal(await pageCount(repair), 1, "repair summary is 1-page — no gold close/QR page");
});

test("funding_summary vs repair_plan_summary stay split", async () => {
  const fund = await generateSummaryDocument("funding_summary", mockCRS, { name: "Jordan" });
  const repair = await generateSummaryDocument("repair_plan_summary", mockCRS, { name: "Jordan" });
  const fundText = extractPdfText(fund);
  const repairText = extractPdfText(repair);
  assert.match(fundText, /Capital Readiness Summary/);
  assert.doesNotMatch(fundText, /Optimization Plan Summary/);
  assert.match(repairText, /Optimization Plan Summary/);
  assert.doesNotMatch(repairText, /Capital Readiness Summary/);
  assert.match(fundText, /Capital Estimates/);
  assert.match(repairText, /Current Profile Status|Priority Actions|Top Recommendations/);
});

test("sanitizePdfText strips fences and QR placeholders", () => {
  assert.equal(sanitizePdfText("x ```json\n{\"a\":1}\n``` y"), "x y");
  assert.equal(sanitizePdfText("go [ QR CODE ] now"), "go now");
  assert.equal(sanitizePdfText("[ Q R   C O D E ]"), "");
});
