// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// The repair pack used to be three bureau letters and nothing else, while the
// Round 3 letter text already told the bureau a CFPB complaint was being filed.
// These tests pin the two documents that close that gap, and — just as important
// — pin the three cases where NO complaint may be produced.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLetterPack,
  buildEscalationComplaints,
  complaintIdentityFromPersonal
} from "./letter-pack.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

// Never call live Claude from a unit test. Same guard as ./letter-pack.test.mjs.
delete process.env.ANTHROPIC_API_KEY;

const CFPB_FILE = "CFPB-Complaint.pdf";
const AG_FILE = "State-Attorney-General-Complaint.pdf";

const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton",
  state: "TX",
  zip: "76205"
});

/** A stored credit pull in the shape crs_results.result arrives in. */
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

const STORED_CRS = Object.freeze({ bureausPulled: ["EQ"], bureaus: { EQ: eqReport() } });

/** A stored pull the Metro 2 checks find nothing wrong with. */
const STORED_CRS_CLEAN = Object.freeze({ bureausPulled: ["EQ"], bureaus: { EQ: {} } });

async function textOf(file) {
  const read = await extractPdfText(file.content);
  return read.text.replace(/\s+/g, " ").trim();
}

describe("repair pack — the escalation ladder", () => {
  test("a repair pack carries the CFPB and state AG complaints", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    assert.equal(out.skip, null, "the complaints must not be skipped on a pull with findings");
    assert.deepEqual(out.files.map((f) => f.filename), [CFPB_FILE, AG_FILE]);
    assert.deepEqual(out.files.map((f) => f.type), ["cfpb_complaint", "state_ag_complaint"]);
    for (const file of out.files) {
      assert.equal(file.contentType, "application/pdf");
      assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
    }
  });

  test("the complaints name the client, the account and the state's own law", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    const cfpb = await textOf(out.files[0]);
    const ag = await textOf(out.files[1]);

    assert.match(cfpb, /CONSUMER FINANCIAL PROTECTION BUREAU COMPLAINT/);
    assert.match(cfpb, /Fixture Client/);
    assert.match(cfpb, /EXAMPLE BANK NA/);
    assert.match(cfpb, /100 Test Ave/);
    // The sworn declaration the complaint forms require.
    assert.match(cfpb, /penalty of perjury/i);

    assert.match(ag, /STATE ATTORNEY GENERAL CONSUMER COMPLAINT/);
    assert.match(ag, /Attorney General of Texas/);
    assert.match(ag, /Deceptive Trade Practices Act/);
    assert.match(ag, /penalty of perjury/i);
  });

  test("no mail date is ever invented", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    const cfpb = await textOf(out.files[0]);
    assert.match(cfpb, /DATE — not mailed yet/,
      "an unmailed round must read as unmailed, never as a date");
    assert.match(cfpb, /Date: _+/, "the complaint is undated until the client signs it");
  });

  test("no findings, no complaint — a claim about nothing is never produced", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS_CLEAN,
      personal: PERSONAL,
      pack: "repair"
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_violations");
  });

  test("no stored credit pull, no complaint", async () => {
    const out = await buildEscalationComplaints({ storedCrs: null, personal: PERSONAL, pack: "repair" });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_stored_crs");
  });

  test("a funding pack never carries a complaint", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "funding"
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "not_repair");
  });
});

describe("repair pack — the whole pack, end to end", () => {
  test("the complaints land last, after the bureau letters", async () => {
    const pack = await buildLetterPack({
      crsResult: null,
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    const names = pack.files.map((f) => f.filename);
    assert.deepEqual(names.slice(-2), [CFPB_FILE, AG_FILE],
      "the escalation documents belong at the end — bureau rounds are worked first");
    assert.equal(pack.complaintCount, 2);
    assert.equal(pack.complaintSkip, null);
    // The pack is no longer empty just because the vendor engine had no result.
    assert.equal(pack.reason, null);
  });

  test("a funding pack reports why it has no complaints", async () => {
    const pack = await buildLetterPack({
      crsResult: null,
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "funding"
    });
    assert.equal(pack.complaintCount, 0);
    assert.equal(pack.complaintSkip, "not_repair");
    assert.ok(!pack.files.some((f) => f.filename === CFPB_FILE || f.filename === AG_FILE));
  });
});

describe("complaint identity", () => {
  test("street and city line are told apart", () => {
    assert.deepEqual(complaintIdentityFromPersonal(PERSONAL), {
      fullName: "Fixture Client",
      addressLine1: "100 Test Ave",
      city: "Denton",
      state: "TX",
      zip: "76205"
    });
  });

  test("a client with no street on file does not get their city printed as one", () => {
    const id = complaintIdentityFromPersonal({
      name: "No Street",
      address: "Denton, TX 76205",
      city: "Denton",
      state: "TX",
      zip: "76205"
    });
    assert.equal(id.addressLine1, "", "a missing street must stay missing, not be filled in");
  });

  test("the placeholder name 'Client' is not printed as a legal name", () => {
    const id = complaintIdentityFromPersonal({ name: "Client", address: "" });
    assert.equal(id.fullName, "");
  });
});
