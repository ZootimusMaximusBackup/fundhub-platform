import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDiyPackage } from "./package.mjs";

const identity = {
  fullName: "Alex Client",
  addressLine1: "9 Oak Ave",
  city: "Austin",
  state: "TX",
  zip: "78701"
};

const v = (ruleId, severity = "strong") => ({
  ruleId,
  severity,
  field: "21",
  observed: 1,
  expected: 0,
  reason: `Fixture ${ruleId}`,
  citations: ["15 U.S.C. § 1681e(b)"],
  metro2Ref: "Exhibit 4",
  creditor: "Midland",
  account_last4: "4521"
});

describe("diy package", () => {
  it("skips bureaus with zero violations", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: {
        EX: [v("M2-011"), v("M2-007", "deletion")],
        TU: []
      },
      identity,
      seed: "diy-test-1"
    });
    assert.equal(r.ok, true);
    const paths = r.files.map((f) => f.path).join("\n");
    assert.match(paths, /ex-metro2|COVER-EX/i);
    assert.doesNotMatch(paths, /tu-metro2|COVER-TU/i);
  });

  it("marks R2/R3 conditional and undated", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: { EQ: [v("M2-011"), v("M2-018", "deletion")] },
      identity,
      seed: "diy-test-2"
    });
    assert.equal(r.ok, true);
    const r2 = r.files.find((f) => /round-2-CONDITIONAL.*r2/i.test(f.path));
    assert.ok(r2, "expected R2 letter file");
    assert.match(r2.text, /DATE — write today's date/);
    assert.ok(r.files.some((f) => /COVER-EQ/.test(f.path)));
  });

  it("splits personal-info and inquiry letters and adds undated complaints", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: {
        EX: [v("M2-011"), v("M2-031"), v("M2-036")]
      },
      identity,
      seed: "diy-test-3"
    });
    assert.equal(r.ok, true);
    const paths = r.files.map((f) => f.path).join("\n");
    assert.match(paths, /ex-metro2\.pdf/);
    assert.match(paths, /ex-personal-info\.pdf/);
    assert.match(paths, /ex-inquiry\.pdf/);
    assert.match(paths, /cfpb-complaint\.pdf/);
    assert.match(paths, /state-ag-complaint\.pdf/);
    const cfpb = r.files.find((f) => /cfpb-complaint/.test(f.path));
    assert.match(cfpb.text, /Date: ____________________/);
    assert.match(cfpb.text, /DATE — not mailed yet/);
    assert.match(cfpb.text, /I declare under penalty of perjury/);
    assert.doesNotMatch(cfpb.text, /fundhub/i);
    const ag = r.files.find((f) => /state-ag-complaint/.test(f.path));
    assert.match(ag.text, /17\.46/);
    assert.match(ag.text, /texasattorneygeneral/i);
    const cover = r.files.find((f) => /06-complaints-CONDITIONAL\/COVER/.test(f.path));
    assert.match(cover.text, /SEND THESE COMPLAINTS ONLY IF/);
    assert.match(cover.text, /DO NOT FILE WITH ROUND 1/);
  });

  it("adds furnisher validation when a collector is named", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: { EQ: [v("M2-011")] },
      identity,
      seed: "diy-test-4",
      furnishers: [{ name: "Midland Credit", account_last4: "4521" }]
    });
    assert.equal(r.ok, true);
    const val = r.files.find((f) => /furnisher-validation-midland-credit/.test(f.path));
    assert.ok(val, "expected furnisher validation PDF");
    assert.match(val.text, /809\(b\)/);
    assert.match(val.text, /30-day validation window/);
  });

  it("refuses dated complaints without dispute authorization", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: { EQ: [v("M2-011")] },
      identity,
      seed: "diy-test-5",
      datedComplaints: true,
      hasAuthorization: false
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "dispute_authorization_required");
  });

  it("builds dated complaints when dispute authorization is on file", async () => {
    const r = await buildDiyPackage({
      violationsByBureau: { EQ: [v("M2-011")] },
      identity,
      seed: "diy-test-6",
      datedComplaints: true,
      hasAuthorization: true
    });
    assert.equal(r.ok, true);
    const cfpb = r.files.find((f) => /cfpb-complaint/.test(f.path));
    assert.ok(cfpb);
    assert.match(cfpb.text, /DATE — not mailed yet/);
    assert.match(cfpb.text, /I declare under penalty of perjury/);
    assert.doesNotMatch(cfpb.text, /fundhub/i);
  });
});
