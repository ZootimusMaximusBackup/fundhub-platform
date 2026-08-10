import test from "node:test";
import assert from "node:assert/strict";

import { mergeBureauReports, newInquiriesFor } from "./crs-map.mjs";

function report({ bureau, score, ssn = "666321120" }) {
  return {
    requestData: { ssn },
    scores: [{ modelName: "FICO Score 9", scoreValue: score, scoreMaximumValue: 900 }],
    tradelines: [{ accountIdentifier: `${bureau}-acct`, currentBalance: 100 }],
    inquiries: [{
      sourceType: bureau === "TU" ? "TransUnion" : bureau === "EX" ? "Experian" : "Equifax",
      inquiryDate: "2026-01-15",
      creditorName: "Test Bank"
    }],
    publicRecords: []
  };
}

test("mergeBureauReports: merges scores, tradelines, inquiries and redacts SSN echo", () => {
  const merged = mergeBureauReports({
    reports: {
      TU: report({ bureau: "TU", score: 701 }),
      EX: report({ bureau: "EX", score: 680 }),
      EQ: report({ bureau: "EQ", score: 690 })
    },
    errors: {},
    requestIds: { TU: "r-tu", EX: "r-ex", EQ: "r-eq" },
    environment: "sandbox",
    pulledAt: "2026-08-10T00:00:00.000Z"
  });

  assert.equal(merged.environment, "sandbox");
  assert.deepEqual(merged.bureausPulled, ["TU", "EX", "EQ"]);
  assert.equal(merged.bureaus_pulled, "TU/EX/EQ");
  assert.equal(merged.scores.tu, 701);
  assert.equal(merged.scores.ex, 680);
  assert.equal(merged.scores.eq, 690);
  assert.equal(merged.tradelines.length, 3);
  assert.equal(merged.inquiries.length, 3);
  assert.equal(merged.bureaus.TU.requestData.ssnLast4, "1120");
  assert.equal(merged.bureaus.TU.requestData.ssnRedacted, true);
  assert.equal(merged.bureaus.TU.requestData.ssn, undefined);
  assert.deepEqual(newInquiriesFor(merged).map((i) => i.bureau).sort(), ["EQ", "EX", "TU"]);
});

test("mergeBureauReports: keeps partial pulls and bureau errors", () => {
  const merged = mergeBureauReports({
    reports: { TU: report({ bureau: "TU", score: 700 }) },
    errors: { EX: "timeout", EQ: "denied" },
    requestIds: { TU: "r-tu" },
    environment: "sandbox"
  });
  assert.deepEqual(merged.bureausPulled, ["TU"]);
  assert.deepEqual(merged.bureauErrors, { EX: "timeout", EQ: "denied" });
  assert.equal(merged.scores.tu, 700);
  assert.equal(merged.scores.ex, null);
});
