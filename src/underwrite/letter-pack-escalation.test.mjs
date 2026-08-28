// COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.
//
// The repair pack used to be three bureau letters and nothing else, while the
// Round 3 letter text already told the bureau a CFPB complaint was being filed.
// These tests pin the two documents that close that gap, the warning sheet that
// must travel with them — and, above everything else, the cases where NO
// complaint may be produced.
//
// THE RULE THESE TESTS EXIST FOR
// Both complaints say, in the client's own voice and signed under penalty of
// perjury, that the client already disputed with the credit bureaus. If the pack
// wrote no dispute letter, that sentence is false. So: no dispute letter in the
// pack, no complaint in the pack. Every test below that says "no complaint" is
// protecting a client from swearing to something that did not happen.
//
// These tests run through buildLetterPackForClient — the function the app itself
// calls — not only through the piece parts. A green result on the piece parts
// alone is how the first version of this shipped broken.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLetterPack,
  buildLetterPackForClient,
  buildEscalationComplaints,
  complaintIdentityFromPersonal
} from "./letter-pack.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

// Never call live Claude from a unit test. Same guard as ./letter-pack.test.mjs.
delete process.env.ANTHROPIC_API_KEY;

const FOLDER = "06-complaints-CONDITIONAL";
const COVER_FILE = `${FOLDER}/COVER.txt`;
const CFPB_FILE = `${FOLDER}/CFPB-Complaint.pdf`;
const AG_FILE = `${FOLDER}/State-Attorney-General-Complaint.pdf`;

const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  city: "Denton",
  state: "TX",
  zip: "76205"
});

/**
 * Stand-in for the dispute letters a pack produced. buildEscalationComplaints
 * refuses without at least one of these, so every direct call has to say
 * out loud whether this pack wrote a dispute round.
 */
const DISPUTE_LETTERS = Object.freeze([
  Object.freeze({ filename: "ex_round1.pdf", type: "dispute", bureau: "experian" })
]);

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

/**
 * THE BROKEN PULL. A single bureau file stored with no `bureaus` key at all —
 * the exact shape called out in CLAUDE.md and pinned in ../finance/crs-tier.test.mjs.
 * The scoring engine throws on it, so the pack can write no dispute letters.
 */
const STORED_CRS_UNSCOREABLE = Object.freeze(eqReport());

/** A real three-bureau pull the engine can score, from the vendored sandbox. */
const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));
const STORED_CRS_SCOREABLE = mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox"
});

/**
 * The two reads buildLetterPackForClient makes. Nothing is written, so this is
 * a stub, not a database — the point is to exercise the real entry point the
 * app calls rather than the piece parts underneath it.
 */
function fakeClientDb(storedCrs) {
  return {
    async query(sql) {
      if (/FROM clients/i.test(sql)) {
        return {
          rows: [{
            first_name: "Fixture",
            last_name: "Client",
            custom_fields: { address: "100 Test Ave", city: "Denton", state: "TX", zip: "76205" },
            outcome_tier: "REPAIR_ONLY"
          }]
        };
      }
      if (/FROM crs_results/i.test(sql)) {
        return { rows: storedCrs ? [{ result: storedCrs }] : [] };
      }
      return { rows: [] };
    }
  };
}

const names = (pack) => pack.files.map((f) => f.filename);
const isComplaint = (name) => name.startsWith(`${FOLDER}/`);

async function textOf(file) {
  const read = await extractPdfText(file.content);
  return read.text.replace(/\s+/g, " ").trim();
}

describe("repair pack — the escalation ladder", () => {
  test("the complaints ship in the conditional folder, behind the cover sheet", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    assert.equal(out.skip, null, "the complaints must not be skipped on a pull with findings");
    assert.deepEqual(out.files.map((f) => f.filename), [COVER_FILE, CFPB_FILE, AG_FILE],
      "the cover sheet leads, and all three sit inside the CONDITIONAL folder");
    assert.deepEqual(out.files.map((f) => f.type ?? null),
      [null, "cfpb_complaint", "state_ag_complaint"]);
    for (const file of out.files.slice(1)) {
      assert.equal(file.contentType, "application/pdf");
      assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
    }
  });

  test("the cover sheet carries the warning, not just the folder name", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    const cover = out.files[0];
    assert.equal(cover.filename, COVER_FILE);
    assert.equal(cover.contentType, "text/plain");
    const text = cover.content.toString("utf8");
    assert.match(text, /SEND THESE COMPLAINTS ONLY IF/);
    assert.match(text, /Round 3 is done/);
    assert.match(text, /DO NOT FILE WITH ROUND 1/);
    assert.match(text, /Sign the perjury declaration by hand/);
  });

  test("the complaints name the client, the account and the state's own law", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    const cfpb = await textOf(out.files[1]);
    const ag = await textOf(out.files[2]);

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
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    const cfpb = await textOf(out.files[1]);
    assert.match(cfpb, /DATE — not mailed yet/,
      "an unmailed round must read as unmailed, never as a date");
    assert.match(cfpb, /Date: _+/, "the complaint is undated until the client signs it");
  });

  test("NO DISPUTE LETTER, NO COMPLAINT — the sworn sentence would be false", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: []
    });
    assert.deepEqual(out.files, [],
      "a client must never be handed a sworn statement that they disputed, when nothing was written");
    assert.equal(out.skip, "no_dispute_letters");
  });

  test("a missing dispute-letter list is a refusal, never a pass", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_dispute_letters");
  });

  test("personal-info and inquiry letters alone are not a dispute round", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: [
        { filename: "personal_info_ex.pdf", type: "personal_info" },
        { filename: "inquiry_ex.pdf", type: "inquiry_removal" }
      ]
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_dispute_letters");
  });

  test("no findings, no complaint — a claim about nothing is never produced", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS_CLEAN,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_violations");
  });

  test("no stored credit pull, no complaint", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: null,
      personal: PERSONAL,
      pack: "repair",
      disputeLetters: DISPUTE_LETTERS
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "no_stored_crs");
  });

  test("a funding pack never carries a complaint", async () => {
    const out = await buildEscalationComplaints({
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "funding",
      disputeLetters: DISPUTE_LETTERS
    });
    assert.deepEqual(out.files, []);
    assert.equal(out.skip, "not_repair");
  });
});

describe("repair pack — through buildLetterPackForClient, the real entry point", () => {
  test("a scoreable pull: dispute letters first, conditional complaints last", async () => {
    const pack = await buildLetterPackForClient(
      fakeClientDb(STORED_CRS_SCOREABLE),
      { clientId: "cl-1", pack: "repair" }
    );
    assert.equal(pack.reason, null);
    assert.equal(pack.engineSkip, null, "the sandbox pull must score cleanly");

    const list = names(pack);
    const disputes = list.filter((n) => /round\d/.test(n));
    assert.ok(disputes.length > 0, "this fixture must produce real dispute letters");
    assert.deepEqual(list.slice(-3), [COVER_FILE, CFPB_FILE, AG_FILE],
      "the escalation documents belong at the end — bureau rounds are worked first");
    assert.equal(pack.complaintCount, 3);
    assert.equal(pack.complaintSkip, null);
    // Nothing loose: every complaint file is inside the CONDITIONAL folder.
    for (const name of list.filter(isComplaint)) {
      assert.ok(name.startsWith(`${FOLDER}/`), `${name} escaped the conditional folder`);
    }
  });

  test("A BROKEN PULL PRODUCES NO COMPLAINT, AND THE ENGINE ERROR SURVIVES", async () => {
    // The regression this whole file exists for. A stored pull the scoring engine
    // cannot read means zero dispute letters. Before the fix the pack still shipped
    // the two complaints, which made the file list non-empty, which erased the
    // engine error from `reason` — and both src/workflows/ds-02-diy-letters.mjs and
    // src/sales/closer-deck.mjs read only "are there files?", so a closer saw a
    // green "Delivered" on a client who received nothing but two sworn complaints.
    const pack = await buildLetterPackForClient(
      fakeClientDb(STORED_CRS_UNSCOREABLE),
      { clientId: "cl-1", pack: "repair" }
    );
    assert.deepEqual(pack.files, [],
      "a pack the engine could not build must hand the client nothing at all");
    assert.equal(pack.complaintCount, 0);
    assert.equal(pack.complaintSkip, "no_dispute_letters");
    assert.equal(pack.reason, "engine_error: rawResponsesFromMerged: no bureau reports to score",
      "the engine error must reach `reason` — that string is the only thing the callers read");
    // What the two callers ask. Both must still read this as a failure.
    assert.equal(pack.files.length ? "Delivered" : "Delivery Failed — Retry",
      "Delivery Failed — Retry");
  });

  test("a client with no credit pull yet is not an engine error", async () => {
    const pack = await buildLetterPackForClient(
      fakeClientDb(null),
      { clientId: "cl-1", pack: "repair" }
    );
    assert.deepEqual(pack.files, []);
    assert.equal(pack.reason, "no_crs_result");
    assert.equal(pack.complaintCount, 0);
  });
});

describe("repair pack — the whole pack, end to end", () => {
  test("no engine result means no dispute letters, so no complaints", async () => {
    const pack = await buildLetterPack({
      crsResult: null,
      storedCrs: STORED_CRS,
      personal: PERSONAL,
      pack: "repair"
    });
    assert.deepEqual(pack.files, []);
    assert.equal(pack.complaintCount, 0);
    assert.equal(pack.complaintSkip, "no_dispute_letters");
    assert.equal(pack.reason, "no_engine_result",
      "an empty pack must still say it is empty — complaint files may never mask it");
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
    assert.ok(!names(pack).some(isComplaint));
  });
});

describe("one implementation, not two", () => {
  test("the repair pack does not build its own complaint documents", () => {
    const src = readFileSync(new URL("./letter-pack.mjs", import.meta.url), "utf8");
    assert.equal(/buildCfpbComplaint|buildStateAgComplaint|renderComplaintPdf/.test(src), false,
      "the complaint pair has exactly one builder — src/metro2/diy/package.mjs maybeComplaintFiles. " +
      "A second copy drifts, and the copy is how the cover sheet went missing the first time.");
    assert.match(src, /maybeComplaintFiles/,
      "the repair pack must call the shared builder");
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
