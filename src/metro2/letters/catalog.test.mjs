import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LETTER_TYPES,
  LETTER_TYPE_LIST,
  splitViolations,
  requiresDeclarationSignature,
  isTradelineRule
} from "./catalog.mjs";
import { agForState, CFPB_FILING } from "./ag-statutes.mjs";
import { handwrittenSignOff, perjuryDeclaration } from "./sign-block.mjs";

describe("letter catalog", () => {
  it("locks eight types", () => {
    assert.equal(LETTER_TYPE_LIST.length, 8);
    assert.equal(new Set(LETTER_TYPE_LIST).size, 8);
  });

  it("splits personal and inquiry rules off tradelines", () => {
    const { tradeline, personal, inquiry } = splitViolations([
      { ruleId: "M2-005" },
      { ruleId: "M2-031" },
      { ruleId: "M2-036" },
      { reason: "no id" }
    ]);
    assert.deepEqual(tradeline.map((v) => v.ruleId), ["M2-005"]);
    assert.deepEqual(personal.map((v) => v.ruleId), ["M2-031"]);
    assert.deepEqual(inquiry.map((v) => v.ruleId), ["M2-036"]);
    assert.equal(isTradelineRule("M2-005"), true);
    assert.equal(isTradelineRule("M2-031"), false);
  });

  it("only CFPB and AG require a declaration signature", () => {
    assert.equal(requiresDeclarationSignature(LETTER_TYPES.CFPB_COMPLAINT), true);
    assert.equal(requiresDeclarationSignature(LETTER_TYPES.STATE_AG_COMPLAINT), true);
    assert.equal(requiresDeclarationSignature(LETTER_TYPES.R1_METRO2), false);
  });
});

describe("ag statutes", () => {
  it("returns Texas DTPA for TX", () => {
    const tx = agForState("tx");
    assert.equal(tx.known, true);
    assert.match(tx.statute, /17\.41/);
    assert.ok(tx.portal.includes("texasattorneygeneral"));
  });

  it("falls back without inventing a statute", () => {
    const hi = agForState("HI");
    assert.equal(hi.known, false);
    assert.match(hi.statute, /Search/);
  });

  it("names the CFPB portal", () => {
    assert.match(CFPB_FILING.portal, /consumerfinance\.gov\/complaint/);
  });
});

describe("sign blocks", () => {
  it("has a sign line and no Fundhub mark", () => {
    const a = handwrittenSignOff("Jane Consumer");
    const b = perjuryDeclaration("Jane Consumer", { stateName: "Texas" });
    assert.match(a, /Signature:/);
    assert.match(b, /perjury/);
    assert.equal(/fundhub/i.test(a + b), false);
  });
});
