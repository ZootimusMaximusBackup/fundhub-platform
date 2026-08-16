import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { violationsByBureauFromMergedCrs, reportAsOf } from "./from-crs.mjs";

function eqReport() {
  return {
    requestedBureaus: { transunion: false, experian: false, equifax: true },
    responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
    creditFiles: [
      {
        creditFileDetail: {
          creditFileInfileDate: "2026-03-01",
          creditFileResultStatusType: "FileReturned",
          sourceType: "Equifax"
        }
      }
    ],
    inquiries: [
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" },
      { creditorName: "EXAMPLE CARD CO", inquiryDate: "2024-05-09", businessType: "Finance", sourceType: "Equifax" }
    ],
    tradelines: [
      {
        accountIdentifier: "5121080011112222",
        accountOpenedDate: "2019-06-12",
        accountOwnershipType: "Individual",
        accountReportedDate: "2024-01-01",
        accountStatusType: "Open",
        accountType: "Revolving",
        creditorName: "EXAMPLE BANK NA",
        currentBalanceAmount: "1842",
        currentRatingType: "AsAgreed",
        sourceType: "Equifax"
      }
    ]
  };
}

describe("violationsByBureauFromMergedCrs", () => {
  it("reads infile date from the bureau file", () => {
    assert.equal(reportAsOf(eqReport()), "2026-03-01");
  });

  it("splits engine findings by bureau from a stored pull", () => {
    const out = violationsByBureauFromMergedCrs({
      bureausPulled: ["EQ"],
      bureaus: { EQ: eqReport() }
    });
    assert.ok(out.EQ?.length > 0);
    assert.equal(out.TU, undefined);
    assert.ok(out.EQ.some((v) => v.ruleId === "M2-005"));
    assert.ok(out.EQ.some((v) => v.ruleId === "M2-036"));
  });

  it("accepts a single bureau body without a bureaus map", () => {
    const out = violationsByBureauFromMergedCrs(eqReport());
    assert.ok(out.EQ?.length > 0);
  });

  it("returns empty when there is no report", () => {
    assert.deepEqual(violationsByBureauFromMergedCrs(null), {});
    assert.deepEqual(violationsByBureauFromMergedCrs({ bureaus: {} }), {});
  });
});
