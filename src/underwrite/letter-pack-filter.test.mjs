import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPack, documentsFromDeliverables, hasFundingAnalysisPdfs, FUNDING_ANALYSIS_FILENAMES } from "./letter-pack-filter.mjs";

const d = {
  documents: {
    creditAnalysis: "analysis",
    roadmap: "road",
    fundingSnapshot: "snap",
    lenderMatchList: "lenders"
  },
  letters: [
    { type: "personal_info", bureau: "experian", text: "pi" },
    { type: "inquiry_removal", bureau: "experian", text: "inq" },
    { type: "dispute", bureau: "experian", round: 1, text: "disp" }
  ]
};

test("funding pack keeps analysis docs plus personal-info and inquiry letters", () => {
  const p = filterPack(d, "funding");
  assert.equal(p.documents.length, 4);
  assert.deepEqual(p.letters.map((l) => l.type).sort(), ["inquiry_removal", "personal_info"]);
});

test("repair pack keeps dispute + personal-info letters and no funding docs", () => {
  const p = filterPack(d, "repair");
  assert.equal(p.documents.length, 0);
  assert.deepEqual(p.letters.map((l) => l.type).sort(), ["dispute", "personal_info"]);
});

test("documentsFromDeliverables drops empty Claude slots", () => {
  assert.equal(documentsFromDeliverables({ creditAnalysis: "x", roadmap: null }).length, 1);
});

test("documentsFromDeliverables drops unknown types and junk input", () => {
  const docs = documentsFromDeliverables({ creditAnalysis: "x", mystery: "nope", jsonDump: "{}" });
  assert.deepEqual(docs.map((d) => d.type), ["credit_analysis"]);
  assert.deepEqual(documentsFromDeliverables(null), []);
  assert.deepEqual(documentsFromDeliverables(undefined), []);
  assert.deepEqual(documentsFromDeliverables("oops"), []);
  assert.deepEqual(documentsFromDeliverables(["x"]), []);
});

test("filterPack drops unknown letter types and junk packs", () => {
  const p = filterPack({
    documents: { creditAnalysis: "x", extra: "y" },
    letters: [{ type: "unknown" }, { type: "inquiry_removal" }, null]
  }, "funding");
  assert.equal(p.documents.length, 1);
  assert.deepEqual(p.letters.map((l) => l.type), ["inquiry_removal"]);
  assert.deepEqual(filterPack(null, "funding"), { documents: [], letters: [] });
  assert.deepEqual(filterPack(undefined, "repair"), { documents: [], letters: [] });
  assert.deepEqual(filterPack([], "funding"), { documents: [], letters: [] });
});

test("hasFundingAnalysisPdfs requires all four analysis PDFs", () => {
  const four = FUNDING_DOC_TYPES_AS_FILES();
  assert.equal(hasFundingAnalysisPdfs(four), true);
  assert.equal(hasFundingAnalysisPdfs(four.slice(0, 3)), false);
  assert.equal(hasFundingAnalysisPdfs([{ filename: "inquiry_ex.pdf" }]), false);
  assert.equal(hasFundingAnalysisPdfs([...four, { filename: "inquiry_ex.pdf" }]), true);
  assert.equal(hasFundingAnalysisPdfs(null), false);
  assert.equal(hasFundingAnalysisPdfs([]), false);
});

function FUNDING_DOC_TYPES_AS_FILES() {
  return Object.entries(FUNDING_ANALYSIS_FILENAMES).map(([type, filename]) => ({ type, filename }));
}
