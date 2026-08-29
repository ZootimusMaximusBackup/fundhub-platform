import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectorsFromViolations } from "./collectors.mjs";
import { persistDiyPackageFiles } from "./persist.mjs";
import { deliverDiyPackageInRepo } from "./deliver.mjs";
import { makeFakeDb } from "../../documents/fake-db.mjs";
import { createStore, memoryProvider } from "../../documents/store.mjs";

const identity = {
  fullName: "Alex Client",
  addressLine1: "9 Oak Ave",
  city: "Austin",
  state: "TX",
  zip: "78701"
};

const v = (ruleId, extra = {}) => ({
  ruleId,
  severity: extra.severity || "strong",
  field: extra.field || "21",
  observed: extra.observed ?? 1,
  expected: extra.expected ?? 0,
  reason: extra.reason || `Fixture ${ruleId}`,
  citations: extra.citations || ["15 U.S.C. § 1681e(b)"],
  metro2Ref: extra.metro2Ref || "Exhibit 4",
  creditor: extra.creditor || "Midland",
  account_last4: extra.account_last4 || "4521",
  collection: extra.collection,
  ...extra
});

function wrapClients(db) {
  const orig = db.query.bind(db);
  const patches = [];
  db.query = async (sql, params) => {
    if (/UPDATE clients SET custom_fields/.test(String(sql))) {
      patches.push(JSON.parse(params[1]));
      return { rows: [], rowCount: 1 };
    }
    return orig(sql, params);
  };
  return { db, patches };
}

describe("collectorsFromViolations", () => {
  it("does not treat a bank tradeline as a collector", () => {
    const out = collectorsFromViolations({
      EX: [v("M2-011", { creditor: "CAPITAL ONE" })]
    });
    assert.equal(out.length, 0);
  });

  it("emits a collector when the engine fired a collection rule", () => {
    const out = collectorsFromViolations({
      EQ: [v("M2-019", { creditor: "Midland Funding", severity: "deletion" })]
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Midland Funding");
    assert.equal(out[0].account_last4, "4521");
    assert.equal(out[0].violations.length, 1);
  });

  it("emits a collector when collection=true even without M2-019", () => {
    const out = collectorsFromViolations({
      TU: [v("M2-007", { creditor: "ABC Collections", collection: true, severity: "deletion" })]
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "ABC Collections");
  });
});

describe("persistDiyPackageFiles", () => {
  it("stores PDFs and skips text covers", async () => {
    const db = makeFakeDb();
    const store = createStore({ provider: memoryProvider() });
    const pdf = Buffer.from("%PDF-1.4 test");
    const out = await persistDiyPackageFiles(db, store, {
      orgId: "org-1",
      clientId: "client-1",
      files: [
        { path: "01-START-HERE-instructions.pdf.txt", text: "HOW TO USE" },
        { path: "03-round-1/ex-metro2.pdf", pdf },
        { path: "06-complaints-CONDITIONAL/cfpb-complaint.pdf", pdf }
      ],
      sourceEventId: "evt-1"
    });
    assert.equal(out.skipped, null);
    assert.equal(out.stored.length, 2);
    assert.equal(out.stored[0].subtype, "metro2_dispute_letter_pack");
    assert.equal(out.stored[1].subtype, "cfpb_complaint");
    const got = await store.get(db._versions[0].storage_key);
    assert.match(got.body.toString("utf8"), /%PDF/);
  });

  it("skips when args are missing", async () => {
    const out = await persistDiyPackageFiles(null, null, { files: [] });
    assert.equal(out.skipped, "missing_args");
    assert.equal(out.stored.length, 0);
  });

  /* The repair letter pack (../../underwrite/letter-pack.mjs) is the same kind
     of deliverable through a different builder, and its files are shaped
     `{ filename, contentType, content, type }`. The exact manifest below is the
     one ../../underwrite/output-baseline.test.mjs pins. */
  it("files the repair letter pack by its own type, not by its filename", async () => {
    const db = makeFakeDb();
    const store = createStore({ provider: memoryProvider() });
    const pdf = Buffer.from("%PDF-1.4 test");
    const out = await persistDiyPackageFiles(db, store, {
      orgId: "org-1",
      clientId: "client-1",
      files: [
        { filename: "ex_round1.pdf", contentType: "application/pdf", content: pdf, type: "dispute", bureau: "experian" },
        { filename: "06-complaints-CONDITIONAL/COVER.txt", contentType: "text/plain", content: Buffer.from("DO NOT FILE WITH ROUND 1") },
        { filename: "06-complaints-CONDITIONAL/CFPB-Complaint.pdf", contentType: "application/pdf", content: pdf, type: "cfpb_complaint" },
        { filename: "06-complaints-CONDITIONAL/State-Attorney-General-Complaint.pdf", contentType: "application/pdf", content: pdf, type: "state_ag_complaint" }
      ],
      sourceEventId: "evt-repair",
      pack: "repair_letter_pack"
    });

    assert.equal(out.skipped, null);
    assert.deepEqual(out.stored.map((s) => s.subtype), [
      "metro2_dispute_letter_pack",
      "cfpb_complaint",
      // The state AG complaint's filename contains no "state-ag-complaint" to
      // match on. Before the type was read, this was filed as a dispute letter.
      "state_ag_complaint"
    ]);
    assert.equal(out.stored.length, 3, "the text cover sheet must not be stored as a PDF");
  });

  it("never stores a text cover sheet, even when its bytes arrive as a Buffer", async () => {
    const db = makeFakeDb();
    const store = createStore({ provider: memoryProvider() });
    const out = await persistDiyPackageFiles(db, store, {
      orgId: "org-1",
      clientId: "client-1",
      files: [
        { filename: "cover.txt", contentType: "text/plain", content: Buffer.from("read me") },
        { path: "08-round-tracker.pdf.txt", content: Buffer.from("tracker") }
      ]
    });
    assert.deepEqual(out.stored, []);
    assert.equal(db._documents.length, 0);
  });

  it("a repair summary keeps its own document type instead of posing as a dispute letter", async () => {
    const db = makeFakeDb();
    const store = createStore({ provider: memoryProvider() });
    const out = await persistDiyPackageFiles(db, store, {
      orgId: "org-1",
      clientId: "client-1",
      files: [{
        filename: "Optimization-Plan-Summary.pdf",
        contentType: "application/pdf",
        content: Buffer.from("%PDF-1.4 plan"),
        type: "repair_plan_summary"
      }]
    });
    assert.equal(out.stored[0].subtype, "repair_plan_summary");
    assert.match(db._documents[0].title, /Optimization Plan Summary/);
  });
});

describe("deliverDiyPackageInRepo", () => {
  it("persists pack PDFs and records document ids", async () => {
    const { db, patches } = wrapClients(makeFakeDb());
    const store = createStore({ provider: memoryProvider() });
    const r = await deliverDiyPackageInRepo(db, {
      orgId: "org-1",
      clientId: "client-1",
      identity,
      seed: "deliver-test-1",
      store,
      violationsByBureau: {
        EQ: [v("M2-011"), v("M2-018", { severity: "deletion" })]
      }
    });
    assert.equal(r.delivered, true);
    assert.ok(r.documents.length >= 1);
    assert.ok(r.documents.every((d) => d.documentId));
    assert.ok(patches.some((p) => p.diy_status === "Ready"));
    assert.ok(patches.some((p) => p.diy_pdf_count === r.documents.length));
  });

  it("builds the pack from a stored CRS pull when no violations are passed", async () => {
    const eqReport = {
      requestedBureaus: { transunion: false, experian: false, equifax: true },
      responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
      creditFiles: [{
        creditFileDetail: {
          creditFileInfileDate: "2026-03-01",
          creditFileResultStatusType: "FileReturned",
          sourceType: "Equifax"
        }
      }],
      inquiries: [],
      tradelines: [{
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountReportedDate: "2024-01-01",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }]
    };
    const { db } = wrapClients(makeFakeDb());
    const orig = db.query;
    db.query = async (sql, params) => {
      if (/FROM crs_results/.test(String(sql))) {
        return { rows: [{ result: { bureaus: { EQ: eqReport } } }] };
      }
      return orig(sql, params);
    };
    const store = createStore({ provider: memoryProvider() });
    const r = await deliverDiyPackageInRepo(db, {
      orgId: "org-1",
      clientId: "client-1",
      identity,
      seed: "deliver-test-crs",
      store
    });
    assert.equal(r.delivered, true);
    assert.ok(r.files.some((f) => /eq-metro2/.test(f.path)));
  });

  it("adds a furnisher validation PDF for a collection finding", async () => {
    const { db } = wrapClients(makeFakeDb());
    const store = createStore({ provider: memoryProvider() });
    const r = await deliverDiyPackageInRepo(db, {
      orgId: "org-1",
      clientId: "client-1",
      identity,
      seed: "deliver-test-2",
      store,
      violationsByBureau: {
        EQ: [v("M2-019", { creditor: "Midland Funding", severity: "deletion" })]
      }
    });
    assert.equal(r.delivered, true);
    assert.ok(
      r.files.some((f) => /furnisher-validation/.test(f.path)),
      `expected validation letter, got ${r.files.map((f) => f.path).join(", ")}`
    );
  });
});
