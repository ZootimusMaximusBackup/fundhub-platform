// The saver stores FIVE documents, not four. F46.
//
// Capital-Readiness-Summary.pdf is the only document that prints "Approved for
// Funding" in words. buildLetterPack has always produced it; the saver dropped
// it on the floor because its type was in neither of the two maps it checks.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  persistFundingLetterFiles,
  FUNDING_ANALYSIS_SUBTYPE
} from "./funding-letter-pdf.mjs";
import { SUBTYPES, SUBTYPE_TITLES } from "../documents/kinds.mjs";

const PDF = Buffer.from("%PDF-1.7 fake", "utf8");

/** Records every storeAndRegister call by watching the two inserts it makes. */
function recordingDb() {
  const registered = [];
  return {
    registered,
    async query(sql, params) {
      if (/INSERT INTO documents/i.test(sql)) {
        registered.push({ sql, params });
        return { rows: [{ id: `doc-${registered.length}`, document_key: `key-${registered.length}` }] };
      }
      if (/INSERT INTO document_versions/i.test(sql)) return { rows: [{ id: "v-1", version_no: 1 }] };
      if (/SELECT/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
}

function memoryStore() {
  return {
    async put() {
      return {
        storageKey: "memory://x",
        mimeType: "application/pdf",
        byteSize: PDF.byteLength,
        checksum: "sha256:0000"
      };
    },
    async get() { return { body: PDF, contentType: "application/pdf" }; }
  };
}

const FIVE_FILES = [
  { filename: "Credit-Analysis-Report.pdf", type: "credit_analysis", content: PDF },
  { filename: "Funding-Snapshot.pdf", type: "funding_snapshot", content: PDF },
  { filename: "Bank-Lender-Match-List.pdf", type: "lender_match", content: PDF },
  { filename: "Credit-Optimization-Roadmap.pdf", type: "roadmap", content: PDF },
  { filename: "Capital-Readiness-Summary.pdf", type: "funding_summary", content: PDF }
];

describe("the funding saver keeps all five deliverables", () => {
  test("the fifth document has a subtype, a title, and a place in the vocabulary", () => {
    assert.equal(FUNDING_ANALYSIS_SUBTYPE.funding_summary, "capital_readiness_summary");
    assert.ok(SUBTYPES.deliverable.includes("capital_readiness_summary"),
      "capital_readiness_summary must be a known deliverable subtype");
    assert.equal(SUBTYPE_TITLES.capital_readiness_summary, "Capital Readiness Summary");
  });

  test("all five are stored, including the Capital Readiness Summary", async () => {
    const db = recordingDb();
    const out = await persistFundingLetterFiles(db, memoryStore(), {
      orgId: "org-1", clientId: "cl-1", files: FIVE_FILES
    });
    assert.equal(out.skipped, null);
    const types = out.stored.map((s) => s.type);
    assert.deepEqual(types.sort(), [
      "credit_analysis", "funding_snapshot", "funding_summary", "lender_match", "roadmap"
    ]);
    assert.equal(out.stored.length, 5, "the fifth document must not be dropped");
  });

  test("it is recognised by filename too, not only by the type field", async () => {
    const db = recordingDb();
    const out = await persistFundingLetterFiles(db, memoryStore(), {
      orgId: "org-1",
      clientId: "cl-1",
      files: [{ filename: "Capital-Readiness-Summary.pdf", content: PDF }]
    });
    assert.deepEqual(out.stored.map((s) => s.type), ["funding_summary"]);
  });

  test("a Metro 2 dispute letter is still refused on the funding path", async () => {
    const db = recordingDb();
    const out = await persistFundingLetterFiles(db, memoryStore(), {
      orgId: "org-1", clientId: "cl-1",
      files: [{ filename: "ex_round1.pdf", type: "dispute", content: PDF }]
    });
    assert.deepEqual(out.stored, []);
  });
});
