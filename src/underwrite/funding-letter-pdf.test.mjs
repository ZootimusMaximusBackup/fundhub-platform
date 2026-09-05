// F46 — THE DELIVERABLES THE SAVER DROPPED, AND THE SILENCE THAT LET IT.
//
// HOW MANY ANALYSIS DOCUMENTS IS NOT A FIXED NUMBER. An ordinary funding client
// gets FIVE. A thin-file or authorized-user-dominant client gets SIX. Four of
// them come from the black-report printer. The other one or two come from a
// different generator entirely
// (vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js, reached
// through generateAllSummaryDocuments):
//
//   funding_summary       — always. letter-pack.mjs names it
//                           Capital-Readiness-Summary.pdf (:85). The delivery
//                           email promises it as item 5
//                           (src/messaging/templates/u02-funding-delivery.html:40).
//   business_prep_summary — ONLY when consumerSignals.tradelines.thinFile is
//                           true or auDominance is over 0.6
//                           (build-documents.js:162-168). letter-pack.mjs names
//                           it Business-Readiness-Guide.pdf (:87) and its own
//                           renderer titles it "Business Readiness Guide"
//                           (summary-doc-generator.js:368).
//
// FUNDING_ANALYSIS_SUBTYPE listed only the printer's four, so the saver's
// analysisTypeOf() returned null for BOTH summaries and the loop skipped them in
// silence. They were built and thrown away.
//
// The root cause was the silence, not the missing keys — one unguarded
// `continue`. Every file is now accounted for: stored, notStored (a deliberate
// exclusion with a reason) or unrecognised (counted, named, logged, and with
// `strict: true`, thrown). The three always add up to the files handed in.
//
// These are the cheap in-memory guards. The end-to-end proof — real pack, real
// Postgres, five rows for an ordinary client and six for an authorized-user-
// dominant one — is funding-letter-pdf.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  persistFundingLetterFiles,
  FUNDING_ANALYSIS_SUBTYPE,
  NOT_STORED_REASON
} from "./funding-letter-pdf.mjs";
import { memoryProvider, createStore } from "../documents/store.mjs";
import { makeFakeDb } from "../documents/fake-db.mjs";
import { COMPLAINT_FOLDER } from "../metro2/diy/package.mjs";
import { LETTER_TYPES } from "../metro2/letters/catalog.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const pdf = (t) => Buffer.from(`%PDF-1.7\n% ${t}\n%%EOF\n`);

/** The five analysis files EVERY funding pack carries, shaped exactly as
    letter-pack.mjs's asFiles() emits them. */
const PACK_FILES = [
  { type: "credit_analysis", filename: "Credit-Analysis-Report.pdf", contentType: "application/pdf", content: pdf("analysis") },
  { type: "funding_snapshot", filename: "Funding-Snapshot.pdf", contentType: "application/pdf", content: pdf("snapshot") },
  { type: "lender_match", filename: "Bank-Lender-Match-List.pdf", contentType: "application/pdf", content: pdf("lenders") },
  { type: "roadmap", filename: "Credit-Optimization-Roadmap.pdf", contentType: "application/pdf", content: pdf("roadmap") },
  { type: "funding_summary", filename: "Capital-Readiness-Summary.pdf", contentType: "application/pdf", content: pdf("summary") }
];

/** The sixth, added only for a thin-file / authorized-user-dominant client. */
const BUSINESS_PREP_FILE = {
  type: "business_prep_summary",
  filename: "Business-Readiness-Guide.pdf",
  contentType: "application/pdf",
  content: pdf("business prep")
};

async function saveAll(files, opts = {}) {
  const db = makeFakeDb();
  const store = createStore(memoryProvider());
  const res = await persistFundingLetterFiles(db, store, {
    orgId: ORG, clientId: CLIENT_ID, files, generatedBy: "f46-test", ...opts
  });
  return { rows: db._documents, res };
}

describe("F46 — the Capital Readiness Summary reaches the documents table", () => {
  test("the analysis subtype map carries six types, not four", () => {
    assert.deepEqual(Object.keys(FUNDING_ANALYSIS_SUBTYPE).sort(), [
      "business_prep_summary", "credit_analysis", "funding_snapshot",
      "funding_summary", "lender_match", "roadmap"
    ]);
    assert.equal(FUNDING_ANALYSIS_SUBTYPE.funding_summary, "funding_summary");
    assert.equal(FUNDING_ANALYSIS_SUBTYPE.business_prep_summary, "business_prep_summary");
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

describe("F46 — the SIXTH deliverable, for a thin-file / AU-dominant client", () => {
  test("six pack files produce six rows — five was the remaining bug", async () => {
    const { rows, res } = await saveAll([...PACK_FILES, BUSINESS_PREP_FILE]);
    assert.equal(res.skipped, null);
    assert.equal(res.stored.length, 6);
    assert.deepEqual(rows.map((r) => r.subtype).sort(), [
      "bank_lender_match_list",
      "business_prep_summary",
      "credit_analysis_report",
      "credit_optimization_roadmap",
      "funding_snapshot",
      "funding_summary"
    ]);
  });

  test("the row carries the title its own renderer draws", async () => {
    const { rows } = await saveAll([...PACK_FILES, BUSINESS_PREP_FILE]);
    const row = rows.find((r) => r.subtype === "business_prep_summary");
    assert.ok(row, "no business_prep_summary row");
    assert.equal(row.title, "Business Readiness Guide");
    assert.equal(row.metadata.docType, "business_prep_summary");
    assert.equal(row.metadata.stack, "funding");
    assert.equal(row.mime_type, "application/pdf");
  });

  test("the sixth gets its own row — it does not collapse onto the fifth", async () => {
    const { rows } = await saveAll([...PACK_FILES, BUSINESS_PREP_FILE]);
    assert.equal(new Set(rows.map((r) => r.document_key)).size, 6);
  });

  test("the pack's nice filename is recognised with no `type` on the file", async () => {
    const { rows } = await saveAll([
      { filename: "Business-Readiness-Guide.pdf", contentType: "application/pdf", content: pdf("bp") }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subtype, "business_prep_summary");
  });

  test("the vendor generator's raw filename is recognised too", async () => {
    // summary-doc-generator.js:455 names it `${spec.type}.pdf`.
    const { rows } = await saveAll([
      { filename: "business_prep_summary.pdf", contentType: "application/pdf", content: pdf("bp") }
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subtype, "business_prep_summary");
  });

  test("an ordinary client's pack still stores exactly five — no phantom sixth", async () => {
    const { rows } = await saveAll(PACK_FILES);
    assert.equal(rows.length, 5);
    assert.ok(!rows.some((r) => r.subtype === "business_prep_summary"));
  });
});

// ── THE ROOT CAUSE: NOTHING LEAVES THIS SAVER IN SILENCE ────────────────────
// Two deliverables vanished through one unguarded `continue`. These guards are
// what stop a seventh doing the same.
describe("F46 root cause — every file is accounted for", () => {
  const UNKNOWN = {
    type: "lender_pitch_deck",
    filename: "Lender-Pitch-Deck.pdf",
    contentType: "application/pdf",
    content: pdf("seventh")
  };

  test("a file the saver does not recognise is counted and named, not dropped", async () => {
    const { rows, res } = await saveAll([...PACK_FILES, UNKNOWN]);
    assert.equal(rows.length, 5);
    assert.equal(res.unrecognised.length, 1);
    assert.equal(res.unrecognised[0].file, "Lender-Pitch-Deck.pdf");
    assert.equal(res.unrecognised[0].type, "lender_pitch_deck");
  });

  test("an unrecognised file is written to the log", async () => {
    const seen = [];
    const real = console.warn;
    console.warn = (...a) => seen.push(a.join(" "));
    try {
      await saveAll([UNKNOWN]);
    } finally {
      console.warn = real;
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0], /funding-letter-pdf/);
    assert.match(seen[0], /Lender-Pitch-Deck\.pdf/);
  });

  test("a recognised pack logs nothing", async () => {
    const seen = [];
    const real = console.warn;
    console.warn = (...a) => seen.push(a.join(" "));
    try {
      await saveAll([...PACK_FILES, BUSINESS_PREP_FILE]);
    } finally {
      console.warn = real;
    }
    assert.deepEqual(seen, []);
  });

  test("strict: true refuses to walk past an unrecognised file", async () => {
    await assert.rejects(
      () => saveAll([...PACK_FILES, UNKNOWN], { strict: true }),
      /unrecognised file Lender-Pitch-Deck\.pdf/
    );
  });

  test("stored + notStored + unrecognised always equals the files handed in", async () => {
    const mixed = [
      ...PACK_FILES,
      BUSINESS_PREP_FILE,
      UNKNOWN,
      { type: "dispute", filename: "ex_round1.pdf", contentType: "application/pdf", content: pdf("d") },
      { type: "operator_checklist", filename: "operator_checklist.pdf", contentType: "application/pdf", content: pdf("op") },
      { type: "repair_plan_summary", filename: "Optimization-Plan-Summary.pdf", contentType: "application/pdf", content: pdf("r") },
      { type: "inquiry_removal", filename: "inquiry_ex.pdf", contentType: "application/pdf", content: pdf("inq") },
      { type: "funding_snapshot", filename: "Funding-Snapshot.pdf", contentType: "application/pdf" }
    ];
    const { res } = await saveAll(mixed);
    assert.equal(res.filesIn, mixed.length);
    assert.equal(
      res.stored.length + res.notStored.length + res.unrecognised.length,
      mixed.length
    );
  });

  test("a Metro 2 round letter is a deliberate exclusion, not an unknown", async () => {
    const { rows, res } = await saveAll([
      { type: "dispute", filename: "ex_round1.pdf", contentType: "application/pdf", content: pdf("d") }
    ]);
    assert.equal(rows.length, 0);
    assert.deepEqual(res.unrecognised, []);
    assert.equal(res.notStored[0].reason, NOT_STORED_REASON.DISPUTE);
  });

  test("the CFPB and state AG complaints are a deliberate exclusion", async () => {
    const { res } = await saveAll([
      { type: LETTER_TYPES.CFPB_COMPLAINT, filename: `${COMPLAINT_FOLDER}/CFPB-Complaint.pdf`, content: pdf("c") },
      { type: LETTER_TYPES.STATE_AG_COMPLAINT, filename: `${COMPLAINT_FOLDER}/State-Attorney-General-Complaint.pdf`, content: pdf("a") }
    ]);
    assert.deepEqual(res.unrecognised, []);
    assert.deepEqual(res.notStored.map((n) => n.reason), [
      NOT_STORED_REASON.ESCALATION, NOT_STORED_REASON.ESCALATION
    ]);
  });

  // DRIFT GUARD. The saver holds its own copy of the complaint folder name so it
  // does not import the whole Metro 2 PDF tree. This test imports the real
  // constant, so if package.mjs ever renames the folder the copy stops matching
  // and this fails.
  test("the complaint cover sheet — no `type` at all — is still classified", async () => {
    const { res } = await saveAll([
      { filename: `${COMPLAINT_FOLDER}/COVER.txt`, contentType: "text/plain", content: Buffer.from("cover") }
    ]);
    assert.deepEqual(res.unrecognised, [],
      `the saver's copy of COMPLAINT_FOLDER no longer matches ${COMPLAINT_FOLDER}`);
    assert.equal(res.notStored[0].reason, NOT_STORED_REASON.ESCALATION);
  });

  test("the repair pack's own summaries are a deliberate exclusion", async () => {
    const { res } = await saveAll([
      { type: "repair_plan_summary", filename: "Optimization-Plan-Summary.pdf", content: pdf("r") },
      { type: "issue_priority_sheet", filename: "issue_priority_sheet.pdf", content: pdf("i") }
    ]);
    assert.deepEqual(res.unrecognised, []);
    assert.deepEqual(res.notStored.map((n) => n.reason), [
      NOT_STORED_REASON.REPAIR_SUMMARY, NOT_STORED_REASON.REPAIR_SUMMARY
    ]);
  });

  test("staff-only paperwork is a deliberate exclusion", async () => {
    const { res } = await saveAll([
      { type: "operator_checklist", filename: "operator_checklist.pdf", content: pdf("o") },
      { type: "hold_notice", filename: "hold_notice.pdf", content: pdf("h") }
    ]);
    assert.deepEqual(res.unrecognised, []);
    assert.deepEqual(res.notStored.map((n) => n.reason), [
      NOT_STORED_REASON.INTERNAL, NOT_STORED_REASON.INTERNAL
    ]);
  });

  test("a funding letter with no bureau is reported, not silently skipped", async () => {
    const { rows, res } = await saveAll([
      { type: "inquiry_removal", filename: "inquiry_removal.pdf", content: pdf("i") }
    ]);
    assert.equal(rows.length, 0);
    assert.equal(res.notStored[0].reason, NOT_STORED_REASON.LETTER_UNADDRESSED);
  });

  test("a recognised deliverable that arrives with no bytes is reported", async () => {
    const { rows, res } = await saveAll([
      { type: "business_prep_summary", filename: "Business-Readiness-Guide.pdf" }
    ]);
    assert.equal(rows.length, 0);
    assert.deepEqual(res.unrecognised, []);
    assert.equal(res.notStored[0].reason, NOT_STORED_REASON.EMPTY);
  });

  test("missing arguments still return the full shape", async () => {
    const res = await persistFundingLetterFiles(null, null, {});
    assert.equal(res.skipped, "missing_args");
    assert.deepEqual(res.stored, []);
    assert.deepEqual(res.notStored, []);
    assert.deepEqual(res.unrecognised, []);
    assert.equal(res.filesIn, 0);
  });
});
