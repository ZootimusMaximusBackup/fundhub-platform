import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCfpbComplaint,
  buildStateAgComplaint,
  renderComplaintPdf
} from "./complaints.mjs";

const identityTx = {
  fullName: "Jane Consumer",
  addressLine1: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  email: "jane@example.com",
  phone: "512-555-0100"
};

const accountsNoField20 = [
  {
    creditor: "ACME Bank",
    accountType: "revolving",
    amount: "1200",
    originalCreditor: "ACME",
    fieldViolations: [
      { ruleId: "M2-007", field: "17A", reason: "Date of account information inconsistent" }
    ]
  }
];

const timelineMissingDates = [
  { round: "R1", summary: "Metro 2 dispute" },
  { round: "R2", summary: "Method of verification request" },
  { round: "R3", date: "2026-06-01", summary: "Final notice" }
];

describe("buildCfpbComplaint", () => {
  it("uses [DATE — not mailed yet] when a timeline date is missing", () => {
    const text = buildCfpbComplaint({
      identity: identityTx,
      accounts: accountsNoField20,
      timeline: timelineMissingDates
    });
    assert.match(text, /R1 \([^)]*\[DATE — not mailed yet\]/);
    assert.match(text, /R2 \([^)]*\[DATE — not mailed yet\]/);
    assert.match(text, /R3 \(2026-06-01\)/);
    assert.doesNotMatch(text, /invent/i);
  });

  it("does not mention Field 20 unless passed in", () => {
    const without = buildCfpbComplaint({
      identity: identityTx,
      accounts: accountsNoField20,
      timeline: timelineMissingDates
    });
    assert.doesNotMatch(without, /Field 20/);
    assert.doesNotMatch(without, /Field 25/);

    const with20 = buildCfpbComplaint({
      identity: identityTx,
      accounts: [
        {
          creditor: "ACME Bank",
          fieldViolations: [{ ruleId: "M2-011", field: "20", reason: "Account status code mismatch" }]
        }
      ]
    });
    assert.match(with20, /Field 20/);
  });

  it("includes perjury declaration and a Signature line", () => {
    const text = buildCfpbComplaint({ identity: identityTx, accounts: accountsNoField20 });
    assert.match(text, /perjury/i);
    assert.match(text, /Signature:/);
  });

  it("has no Fundhub mark", () => {
    const text = buildCfpbComplaint({
      identity: identityTx,
      company: { name: "Equifax Information Services LLC", address: "P.O. Box 740256", kind: "bureau" },
      accounts: accountsNoField20,
      timeline: timelineMissingDates,
      harm: "Denied a car loan"
    });
    assert.equal(/fundhub/i.test(text), false);
  });

  it("lists bureau P.O. boxes when company is missing", () => {
    const text = buildCfpbComplaint({ identity: identityTx, accounts: accountsNoField20 });
    assert.match(text, /P\.O\. Box 740256/);
    assert.match(text, /P\.O\. Box 4500/);
    assert.match(text, /P\.O\. Box 2000/);
  });
});

describe("buildStateAgComplaint", () => {
  it("Texas AG includes 17.46 and the texasattorneygeneral portal", () => {
    const text = buildStateAgComplaint({
      identity: identityTx,
      accounts: accountsNoField20,
      timeline: timelineMissingDates,
      harm: "Higher interest on a car loan"
    });
    assert.match(text, /17\.46/);
    assert.match(text, /texasattorneygeneral/);
    assert.match(text, /laws of Texas/);
    assert.match(text, /perjury/i);
    assert.match(text, /Signature:/);
    assert.equal(/fundhub/i.test(text), false);
  });

  it("HI (unknown) does not invent a numbered statute and includes Search", () => {
    const text = buildStateAgComplaint({
      identity: { ...identityTx, state: "HI", city: "Honolulu", zip: "96813" },
      accounts: accountsNoField20,
      timeline: timelineMissingDates
    });
    assert.match(text, /Search/);
    assert.doesNotMatch(text, /17\.46/);
    assert.doesNotMatch(text, /HRS|Haw\.\s*Rev\.?\s*Stat/i);
    assert.match(text, /\[DESCRIBE HARM\]/);
  });

  it("uses [DATE — not mailed yet] when a timeline date is missing", () => {
    const text = buildStateAgComplaint({
      identity: identityTx,
      timeline: [{ round: "R1", summary: "First mail" }]
    });
    assert.match(text, /\[DATE — not mailed yet\]/);
  });
});

/*
 * The heading over the item list is a statement of what our engine found, and
 * the complaint is signed under penalty of perjury. Derogatory-item claims
 * (../diy/derogatory.mjs) carry a ruleId and field:null and assert no Metro 2
 * defect, so they must not be filed under a Metro 2 heading.
 */
const derogOnly = [
  {
    creditor: "MIDLAND CREDIT MGMT",
    accountType: "EQ",
    fieldViolations: [
      {
        ruleId: "DEROG-COLLECTION",
        field: null,
        reason: "MIDLAND CREDIT MGMT is reported as a collection account."
      }
    ]
  }
];

const metro2Only = [
  {
    creditor: "ACME Bank",
    fieldViolations: [{ ruleId: "M2-011", field: "20", reason: "Account status code mismatch" }]
  }
];

const mixedAccount = [
  {
    creditor: "ACME Bank",
    fieldViolations: [
      { ruleId: "DEROG-CHARGEOFF", field: null, reason: "Reported as a charge-off." },
      { ruleId: "M2-011", field: "20", reason: "Account status code mismatch" }
    ]
  }
];

const METRO2_HEADING = /Metro 2 field violations reported on this account:/;
const PLAIN_HEADING = /Items disputed on this account:/;

describe("the DISPUTED ACCOUNTS heading tells the truth about the claim type", () => {
  it("derogatory-only account: no Metro 2 heading, and the item line survives", () => {
    for (const build of [buildCfpbComplaint, buildStateAgComplaint]) {
      const text = build({ identity: identityTx, accounts: derogOnly });
      assert.doesNotMatch(text, METRO2_HEADING);
      assert.match(text, PLAIN_HEADING);
      assert.match(text, /DEROG-COLLECTION — MIDLAND CREDIT MGMT is reported as a collection account\./);
    }
  });

  it("derogatory-only complaint says nothing about Metro 2 anywhere", () => {
    const text = buildCfpbComplaint({
      identity: identityTx,
      accounts: derogOnly,
      timeline: [{ round: "R1", summary: "Initial dispute via certified mail." }]
    });
    assert.equal(/metro\s*2/i.test(text), false);
  });

  it("an account carrying an M2- rule still gets the Metro 2 heading", () => {
    for (const build of [buildCfpbComplaint, buildStateAgComplaint]) {
      const text = build({ identity: identityTx, accounts: metro2Only });
      assert.match(text, METRO2_HEADING);
      assert.doesNotMatch(text, PLAIN_HEADING);
    }
  });

  it("a mixed account keeps the Metro 2 heading — the Metro 2 claim really is there", () => {
    const text = buildCfpbComplaint({ identity: identityTx, accounts: mixedAccount });
    assert.match(text, METRO2_HEADING);
    assert.doesNotMatch(text, PLAIN_HEADING);
    assert.match(text, /DEROG-CHARGEOFF/);
    assert.match(text, /M2-011/);
  });

  it("headings are decided per account, not per complaint", () => {
    const text = buildCfpbComplaint({
      identity: identityTx,
      accounts: [...derogOnly, ...metro2Only]
    });
    assert.match(text, METRO2_HEADING);
    assert.match(text, PLAIN_HEADING);
  });
});

describe("renderComplaintPdf", () => {
  it("returns %PDF", async () => {
    const text = buildCfpbComplaint({ identity: identityTx, accounts: accountsNoField20 });
    const bytes = await renderComplaintPdf(text, identityTx);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "%PDF");
    assert.ok(bytes.byteLength > 500);
  });
});
