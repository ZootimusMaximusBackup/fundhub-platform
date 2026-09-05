// F46 — THE FIFTH DELIVERABLE MUST BE SAVED, NOT DROPPED.
//
// The funding pack a client pays for has five analysis documents in it. Four
// come from the black-report printer. The fifth, the Capital Readiness Summary,
// comes from a different generator entirely
// (vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js, reached
// through generateAllSummaryDocuments) and letter-pack.mjs stamps it
// `type: "funding_summary"` and names it Capital-Readiness-Summary.pdf (:85).
//
// FUNDING_ANALYSIS_SUBTYPE listed four types, so the saver's analysisTypeOf()
// returned null for that fifth file and the loop skipped it in silence. The
// document was built and thrown away, while the delivery email promises it as
// item 5 (src/messaging/templates/u02-funding-delivery.html:40).
//
// These are the cheap in-memory guards. The end-to-end proof — real pack, real
// Postgres, five rows in `documents` — is funding-letter-pdf.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { persistFundingLetterFiles, FUNDING_ANALYSIS_SUBTYPE } from "./funding-letter-pdf.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const pdf = (t) => Buffer.from(`%PDF-1.7\n% ${t}\n%%EOF\n`);

/** The five analysis files a funding pack carries, shaped exactly as
    letter-pack.mjs's asFiles() emits them. */
const PACK_FILES = [
  { type: "credit_analysis", filename: "Credit-Analysis-Report.pdf", contentType: "application/pdf", content: pdf("analysis") },
  { type: "funding_snapshot", filename: "Funding-Snapshot.pdf", contentType: "application/pdf", content: pdf("snapshot") },
  { type: "lender_match", filename: "Bank-Lender-Match-List.pdf", contentType: "application/pdf", content: pdf("lenders") },
  { type: "roadmap", filename: "Credit-Optimization-Roadmap.pdf", contentType: "application/pdf", content: pdf("roadmap") },
  { type: "funding_summary", filename: "Capital-Readiness-Summary.pdf", contentType: "application/pdf", content: pdf("summary") }
];

async function saveAll(files) {
  const db = makeFakeDb();
  const store = createStore(memoryProvider());
  const res = await persistFundingLetterFiles(db, store, {
    orgId: ORG, clientId: CLIENT_ID, files, generatedBy: "f46-test"
  });
  return { rows: db._documents, res };
}

describe("F46 — the Capital Readiness Summary reaches the documents table", () => {
  test("the analysis subtype map carries five types, not four", () => {
    assert.deepEqual(Object.keys(FUNDING_ANALYSIS_SUBTYPE).sort(), [
      "credit_analysis", "funding_snapshot", "funding_summary", "lender_match", "roadmap"
    ]);
    assert.equal(FUNDING_ANALYSIS_SUBTYPE.funding_summary, "funding_summary");
  });

  test("all five pack files are stored — four was the bug", async () => {
    const { rows, res } = await saveAll(PACK_FILES);
    assert.equal(res.skipped, null);
    assert.equal(res.stored.length, 5);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((r) => r.subtype).sort(), [
      "bank_lender_match_list",
      "credit_analysis_report",
      "credit_optimization_roadmap",
      "funding_snapshot",
      "funding_summary"
    ]);
  });

  test("the summary row is titled Capital Readiness Summary", async () => {
    const { rows } = await saveAll(PACK_FILES);
    const row = rows.find((r) => r.subtype === "funding_summary");
    assert.ok(row, "no funding_summary row");
    assert.equal(row.title, "Capital Readiness Summary");
    assert.equal(row.metadata.docType, "funding_summary");
    assert.equal(row.metadata.stack, "funding");
    assert.equal(row.mime_type, "application/pdf");
  });

  test("each of the five gets its OWN row — none collapses onto another", async () => {
    const { rows } = await saveAll(PACK_FILES);
    const keys = new Set(rows.map((r) => r.document_key));
    assert.equal(keys.size, 5);
  });

  test("a file with no type is still recognised by its filename", async () => {
    const { rows } = await saveAll([
      { filename: "Capital-Readiness-Summary.pdf", contentType: "application/pdf", content: pdf("summary") }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subtype, "funding_summary");
  });

  test("the vendor generator's raw filename is recognised too", async () => {
    // summary-doc-generator.js:455 names it `${spec.type}.pdf`.
    const { rows } = await saveAll([
      { filename: "funding_summary.pdf", contentType: "application/pdf", content: pdf("summary") }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subtype, "funding_summary");
  });

  test("the REPAIR pack's own summary is NOT dragged onto the funding stack", async () => {
    // repair_plan_summary / Optimization-Plan-Summary.pdf belongs to the repair
    // pack (letter-pack.mjs:86). Nothing here should claim it.
    const { rows } = await saveAll([
      { type: "repair_plan_summary", filename: "Optimization-Plan-Summary.pdf", contentType: "application/pdf", content: pdf("repair") }
    ]);
    assert.equal(rows.length, 0);
  });

  test("the four that already worked still work, unchanged", async () => {
    const { rows } = await saveAll(PACK_FILES.slice(0, 4));
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((r) => r.subtype).sort(), [
      "bank_lender_match_list",
      "credit_analysis_report",
      "credit_optimization_roadmap",
      "funding_snapshot"
    ]);
  });
});
