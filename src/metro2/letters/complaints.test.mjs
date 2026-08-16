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

describe("renderComplaintPdf", () => {
  it("returns %PDF", async () => {
    const text = buildCfpbComplaint({ identity: identityTx, accounts: accountsNoField20 });
    const bytes = await renderComplaintPdf(text, identityTx);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "%PDF");
    assert.ok(bytes.byteLength > 500);
  });
});
