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
});
