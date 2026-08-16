import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LETTER_TYPES } from "./catalog.mjs";
import {
  buildFurnisherValidationLetter,
  renderFurnisherValidationPdf
} from "./furnisher-validation.mjs";

const furnisher = {
  name: "Midland Credit Management",
  addressLines: ["P.O. Box 939063", "San Diego, CA 92193"]
};

const account = {
  creditor: "Midland Credit Management",
  last4: "4521",
  balanceLabel: "$1,204.00",
  originalCreditor: "Synchrony Bank",
  accountType: "collection"
};

const txIdentity = {
  fullName: "Jane Consumer",
  addressLine1: "500 Congress Ave",
  city: "Austin",
  state: "TX",
  zip: "78701"
};

const azIdentity = {
  fullName: "Jane Consumer",
  addressLine1: "123 Main St",
  city: "Phoenix",
  state: "AZ",
  zip: "85001"
};

describe("furnisher validation letter", () => {
  it("TX letter mentions 4 years", () => {
    const { text, type, solYears } = buildFurnisherValidationLetter({
      identity: txIdentity,
      furnisher,
      account
    });
    assert.equal(type, LETTER_TYPES.FURNISHER_VALIDATION);
    assert.equal(solYears, 4);
    assert.match(text, /4 years/);
    assert.match(text, /Midland Credit Management/);
    assert.match(text, /alleged/);
    assert.match(text, /ending 4521/);
    assert.match(text, /original signed agreement/i);
    assert.match(text, /1006\.34/);
    assert.match(text, /chain of title/i);
    assert.match(text, /authorized to collect/i);
    assert.match(text, /Certified Mail/i);
    assert.match(text, /Signature:/);
    assert.equal(/Field\s+24/i.test(text), false);
    assert.equal(/Metro\s*2/i.test(text), false);
  });

  it("AZ letter does not claim 4 years", () => {
    const { text, solYears } = buildFurnisherValidationLetter({
      identity: azIdentity,
      furnisher,
      account
    });
    assert.equal(solYears, null);
    assert.equal(/4 years/i.test(text), false);
    assert.equal(/four-year/i.test(text), false);
    assert.match(text, /verify the statute of limitations in my state/);
  });

  it("809(b) and 1692k appear", () => {
    const { text } = buildFurnisherValidationLetter({
      identity: azIdentity,
      furnisher,
      account
    });
    assert.match(text, /809\(b\)/);
    assert.match(text, /1692g\(b\)/);
    assert.match(text, /1692k/);
    assert.match(text, /813/);
    assert.match(text, /cease collection/i);
    assert.match(text, /credit bureau reporting/i);
    assert.match(text, /not a lawsuit/i);
  });

  it("cover mentions 30-day window", () => {
    const { text } = buildFurnisherValidationLetter({
      identity: azIdentity,
      furnisher,
      account
    });
    assert.match(text, /^COVER/m);
    assert.match(text, /30-day validation window/);
    assert.match(text, /bureau\/furnisher FCRA dispute/);
  });

  it("no Fundhub", () => {
    const { text } = buildFurnisherValidationLetter({
      identity: txIdentity,
      furnisher,
      account,
      asOf: "2026-08-15"
    });
    assert.equal(/fundhub/i.test(text), false);
    assert.match(text, /August 15, 2026/);
  });

  it("last four only even if a longer number is passed", () => {
    const { text } = buildFurnisherValidationLetter({
      identity: azIdentity,
      furnisher,
      account: { ...account, last4: "4111111111111111" }
    });
    assert.match(text, /ending 1111/);
    assert.equal(/4111111111111111/.test(text), false);
  });

  it("PDF header", async () => {
    const bytes = await renderFurnisherValidationPdf({
      identity: txIdentity,
      furnisher,
      account,
      asOf: "2026-08-15"
    });
    assert.ok(bytes.byteLength > 500);
    assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]), "%PDF");
  });
});
