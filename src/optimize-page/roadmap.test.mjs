import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOptimizeRoadmap, SAMPLE_STORED_FILE } from "./roadmap.mjs";

test("buildOptimizeRoadmap runs the existing brain on the stored sample file", () => {
  const out = buildOptimizeRoadmap();
  assert.equal(out.ok, true);
  assert.equal(out.source, "sample");
  assert.equal(out.bookUrl, "https://apply.fundhub.ai/schedule/phonecall");
  assert.equal(out.rounds.length, 6);
  assert.equal(out.rounds[0].step, "R1");
  assert.equal(out.rounds[0].status, "current");
  assert.ok(out.rounds[0].attacks.length > 0, "metro2 findings must land on R1");
  assert.ok(out.accounts.some((a) => a.name === "EXAMPLE BANK NA"));
});

test("buildOptimizeRoadmap uses a passed file instead of inventing one", () => {
  const out = buildOptimizeRoadmap({ crsResult: SAMPLE_STORED_FILE });
  assert.equal(out.source, "file");
  assert.equal(out.rounds[0].attacks.length > 0, true);
});

test("buildOptimizeRoadmap does not invent a second planner or a new product title", () => {
  const out = buildOptimizeRoadmap();
  const blob = JSON.stringify(out);
  assert.doesNotMatch(blob, /credit repair/i);
  assert.doesNotMatch(blob, /Consulting Services/);
});

/* ─────────────────────────────────────────────────────────────────────────────
   OWNER DECISION, 2026-09-03: "any derogatory deserves a letter, but only if
   they are in the correct offer path."

   COMPLIANCE REVIEW REQUIRED — dispute logic.

   The file below is a collection and a charge-off, both reported perfectly, so
   all 38 Metro 2 checks come back empty. The roadmap drew nothing for it: no
   findings, no attacks on any round. A wrecked report read as a clean one.
   ───────────────────────────────────────────────────────────────────────────── */

const derogRecord = (over = {}) => ({
  creditorName: "EXAMPLE BANK NA",
  accountIdentifier: "SIM-EXAMPLE-4021",
  accountOpenedDate: "2021-03-02",
  accountReportedDate: "2026-08-28",
  accountOwnershipType: "Individual",
  accountStatusType: "Open",
  accountType: "Revolving",
  loanType: "CreditCard",
  businessType: "Banking",
  currentRatingType: "AsAgreed",
  currentBalanceAmount: "2870",
  pastDueAmount: "0",
  _30DayLates: "0",
  _60DayLates: "0",
  _90DayLates: "0",
  sourceType: "Experian",
  ...over
});

const DEROGATORY_ONLY_FILE = {
  bureausPulled: ["EX"],
  bureaus: {
    EX: {
      creditFiles: [{
        creditFileDetail: {
          creditFileInfileDate: "2026-09-03",
          creditFileResultStatusType: "FileReturned",
          sourceType: "Experian"
        }
      }],
      inquiries: [],
      tradelines: [
        derogRecord({
          creditorName: "MIDLAND CREDIT MANAGEMENT",
          accountIdentifier: "SIM-MCM-6642",
          businessType: "Collection",
          loanType: "CollectionAgencyAttorney",
          currentRatingType: "CollectionOrChargeOff",
          currentBalanceAmount: "1840"
        }),
        derogRecord({
          creditorName: "CAP ONE BANK",
          accountIdentifier: "SIM-CAP-7729",
          currentRatingType: "CollectionOrChargeOff",
          currentBalanceAmount: "2100"
        })
      ]
    }
  },
  normalized: { tradelines: [], inquiries: [] }
};

test("a repair-path client's collection and charge-off land on the roadmap", () => {
  const out = buildOptimizeRoadmap({ crsResult: DEROGATORY_ONLY_FILE, onRepairPath: true });
  assert.equal(out.findings.length, 2, "one claim per derogatory account");
  assert.deepEqual(
    out.findings.map((f) => f.rule_id).sort(),
    ["DEROG-CHARGEOFF", "DEROG-COLLECTION"]
  );
  assert.ok(
    out.rounds[0].attacks.some((a) => /MIDLAND CREDIT MANAGEMENT/.test(a)),
    `expected the collection on Round 1, got ${JSON.stringify(out.rounds[0].attacks)}`
  );
  // These claims assert no Metro 2 defect, so they must name no Metro 2 field.
  for (const f of out.findings) {
    assert.equal(f.field, "");
    assert.equal(f.metro2Ref, "");
    assert.ok(f.reason.length > 0, "a person has to be told why the line is disputed");
    assert.ok(f.citations.length >= 3, "and on what authority");
  }
});

test("the same file off the repair path draws nothing — and neither does the public page", () => {
  const off = buildOptimizeRoadmap({ crsResult: DEROGATORY_ONLY_FILE });
  assert.deepEqual(off.findings, []);
  assert.deepEqual(off.rounds[0].attacks, []);

  // /api/public/optimize is a no-auth referral door: it calls this with no
  // arguments, so a stranger on no offer path must see what they always saw.
  const publicPage = buildOptimizeRoadmap();
  assert.deepEqual(publicPage, buildOptimizeRoadmap({ onRepairPath: true }),
    "the sample file carries no derogatory account, so the flag cannot move it");
});
