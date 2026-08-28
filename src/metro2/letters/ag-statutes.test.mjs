// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// These tests guard the addresses a Round 5 state attorney general complaint is
// mailed to. That complaint is signed by the consumer UNDER PENALTY OF PERJURY,
// so the failure these tests exist to prevent is not a crash — it is a sworn
// document mailed to an address that does not receive it, while the client and
// the staff both believe it was filed.
//
// TWO RULES, AND THE SECOND ONE MATTERS MOST:
//
//   1. AN ADDRESS THAT IS PRESENT MUST BE WHOLE. A half-filled address is worse
//      than none, because it looks filed and is not.
//   2. A STATE THAT IS NOT CONFIRMED MUST STAY UNMAILABLE. No nearest office, no
//      general administrative address, no neighbouring state.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AG_MAIL_BY_STATE,
  AG_MAIL_UNRESOLVED,
  CFPB_FILING,
  CFPB_MAIL_ADDRESS,
  agForState,
  agIsMailable,
  agPostalAddress
} from "./ag-statutes.mjs";

const SOURCE = readFileSync(new URL("./ag-statutes.mjs", import.meta.url), "utf8");

/** All fifty states. Not a list to edit — it is what "50 states" means. */
const FIFTY_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

/**
 * The states Round 5 can actually mail today. Pinned by name, not by count, so
 * that adding or removing one is a deliberate edit to this list and shows up in
 * review next to the address itself.
 */
const MAILABLE = [
  "AL", "AZ", "AR", "CA", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KY", "LA", "MD", "MA", "MI", "MN", "MO", "MT",
  "NE", "NH", "NJ", "NM", "NC", "ND", "OH", "PA", "SD", "TN",
  "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

/** The states with no confirmed complaint mailing address. Round 5 refuses these. */
const UNRESOLVED = ["AK", "CO", "CT", "KS", "ME", "MS", "NV", "NY", "OK", "OR", "RI", "SC"];

const ZIP = /^\d{5}(-\d{4})?$/;

/** The line the Postal Service delivers to: the last one before the city. */
function deliveryLine(addr) {
  return addr.address_line2 || addr.address_line1;
}

/** Only the AG_MAIL_BY_STATE section, so AG_BY_STATE's keys cannot be mistaken for it. */
function mailSectionText() {
  const from = SOURCE.indexOf("export const AG_MAIL_BY_STATE");
  const to = SOURCE.indexOf("export const AG_MAIL_UNRESOLVED");
  assert.ok(from > 0 && to > from, "AG_MAIL_BY_STATE section not found");
  return SOURCE.slice(from, to);
}

function unresolvedSectionText() {
  const from = SOURCE.indexOf("export const AG_MAIL_UNRESOLVED");
  const to = SOURCE.indexOf("export function agPostalAddress");
  assert.ok(from > 0 && to > from, "AG_MAIL_UNRESOLVED section not found");
  return SOURCE.slice(from, to);
}

describe("the fifty states are all accounted for", () => {
  test("every state is either mailable or recorded as unresolved — none is simply missing", () => {
    const covered = [...Object.keys(AG_MAIL_BY_STATE), ...Object.keys(AG_MAIL_UNRESOLVED)].sort();
    assert.deepEqual(covered, [...FIFTY_STATES].sort());
  });

  test("no state is in both lists", () => {
    for (const code of Object.keys(AG_MAIL_BY_STATE)) {
      assert.equal(code in AG_MAIL_UNRESOLVED, false, `${code} is both mailable and unresolved`);
    }
  });

  test("the mailable list is exactly the states pinned above", () => {
    assert.deepEqual(Object.keys(AG_MAIL_BY_STATE).sort(), [...MAILABLE].sort());
    assert.deepEqual(Object.keys(AG_MAIL_UNRESOLVED).sort(), [...UNRESOLVED].sort());
  });
});

describe("an address that is present must be whole", () => {
  test("every address has a street, a city, a two-letter state and a ZIP that looks like a ZIP", () => {
    for (const [code, rec] of Object.entries(AG_MAIL_BY_STATE)) {
      const a = rec.address;
      assert.ok(a && typeof a === "object", `${code} has no address object`);

      const street = deliveryLine(a);
      assert.equal(typeof street, "string", `${code} has no delivery line`);
      assert.ok(street.trim().length >= 5, `${code} delivery line is too short to be an address: ${street}`);
      assert.match(street, /\d/, `${code} delivery line has no number in it: ${street}`);

      assert.equal(typeof a.address_city, "string", `${code} has no city`);
      assert.ok(a.address_city.trim().length >= 3, `${code} city is too short: ${a.address_city}`);

      assert.match(a.address_state, /^[A-Z]{2}$/, `${code} state is not two letters: ${a.address_state}`);
      assert.match(a.address_zip, ZIP, `${code} ZIP does not look like a ZIP: ${a.address_zip}`);

      assert.equal(typeof a.company_name, "string", `${code} has no addressee`);
      assert.ok(a.company_name.trim().length >= 5, `${code} addressee is too short: ${a.company_name}`);
      assert.equal(a.address_country, "US", `${code} is not addressed in the US`);
    }
  });

  test("an address is filed under its own state, not another one", () => {
    for (const [code, rec] of Object.entries(AG_MAIL_BY_STATE)) {
      assert.equal(rec.address.address_state, code,
        `${code} holds an address whose state line says ${rec.address.address_state}`);
    }
  });

  test("no field is blank, padded, or a leftover placeholder", () => {
    for (const [code, rec] of Object.entries(AG_MAIL_BY_STATE)) {
      for (const [key, value] of Object.entries(rec.address)) {
        if (value === null) {
          assert.equal(key, "address_line2", `${code} left ${key} null`);
          continue;
        }
        assert.equal(typeof value, "string", `${code} ${key} is not text`);
        assert.notEqual(value.trim(), "", `${code} ${key} is blank`);
        assert.equal(value, value.trim(), `${code} ${key} has stray spaces: "${value}"`);
        assert.doesNotMatch(value, /\[|TODO|TBD|UNKNOWN|XXX/i, `${code} ${key} is a placeholder: ${value}`);
      }
    }
  });

  test("two states never share one address — a copied entry is caught", () => {
    const seen = new Map();
    for (const [code, rec] of Object.entries(AG_MAIL_BY_STATE)) {
      const a = rec.address;
      const key = [a.address_line1, a.address_line2, a.address_city, a.address_zip].join("|").toUpperCase();
      assert.equal(seen.has(key), false, `${code} has the same address as ${seen.get(key)}`);
      seen.set(key, code);
    }
  });

  test("every state name and office name is filled in", () => {
    for (const [code, rec] of Object.entries(AG_MAIL_BY_STATE)) {
      assert.ok(rec.stateName && rec.stateName.length > 3, `${code} has no state name`);
      assert.equal(rec.office, rec.address.company_name,
        `${code} names one office in the letter and a different one on the envelope`);
    }
  });
});

describe("every address can be re-checked without starting over", () => {
  test("each mailable state carries its source URL in a comment", () => {
    const section = mailSectionText();
    const blocks = section.split(/\n  ([A-Z]{2}): Object\.freeze\(\{/);
    // blocks[0] is the section header; then [code, body] pairs.
    const found = new Set();
    for (let i = 1; i < blocks.length; i += 2) {
      const code = blocks[i];
      const commentBefore = blocks[i - 1];
      assert.match(commentBefore, /\/\/ Source: https:\/\/\S+\s*$/,
        `${code} has no "// Source: https://..." line directly above it`);
      found.add(code);
    }
    assert.deepEqual([...found].sort(), Object.keys(AG_MAIL_BY_STATE).sort());
  });

  test("each unresolved state records what was checked and why nothing was recorded", () => {
    const section = unresolvedSectionText();
    for (const code of Object.keys(AG_MAIL_UNRESOLVED)) {
      const rec = AG_MAIL_UNRESOLVED[code];
      assert.ok(rec.why && rec.why.length > 20, `${code} does not say why it is unresolved`);
      assert.ok(rec.stateName && rec.stateName.length > 3, `${code} has no state name`);
    }
    const blocks = section.split(/\n  ([A-Z]{2}): Object\.freeze\(\{/);
    for (let i = 1; i < blocks.length; i += 2) {
      assert.match(blocks[i - 1], /\/\/ Checked: https:\/\/\S+\s*$/,
        `${blocks[i]} has no "// Checked: https://..." line directly above it`);
    }
  });
});

describe("an unconfirmed state stays unmailable", () => {
  test("every unresolved state has no postal address at all", () => {
    for (const code of UNRESOLVED) {
      assert.equal(agPostalAddress(code), null, `${code} gained an address without being reviewed`);
      assert.equal(agIsMailable(code), false, `${code} became mailable without being reviewed`);
    }
  });

  test("a general office address is never substituted for a missing one", () => {
    // These four states DO publish an office address. It is deliberately absent.
    // NV, NY, OK and OR publish no postal route for a consumer complaint; the
    // only address on their sites is the general office.
    for (const [code, forbidden] of [
      ["NV", "100 N. Carson"],
      ["NY", "The Capitol"],
      ["OK", "313 NE 21st"],
      ["OR", "1162 Court"]
    ]) {
      assert.equal(agPostalAddress(code), null, `${code} is mailable and must not be`);
      assert.equal(SOURCE.includes(`address_line1: "${forbidden}`), false,
        `${code}'s general office address was recorded as a complaint address`);
    }
  });

  test("anything that is not a state gets nothing", () => {
    for (const code of ["DC", "PR", "GU", "VI", "AS", "MP", "ZZ", "XX", "", "   ", null, undefined, 0, {}, []]) {
      assert.equal(agPostalAddress(code), null, `${JSON.stringify(code)} produced an address`);
    }
  });

  test("a lowercase or padded state code is read the same way", () => {
    assert.deepEqual(agPostalAddress(" tx "), agPostalAddress("TX"));
    assert.equal(agPostalAddress(" ny "), null);
  });
});

describe("the table cannot be edited by accident", () => {
  test("the caller gets a copy — writing to it does not change the table", () => {
    const first = agPostalAddress("TX");
    first.address_line1 = "999 Nowhere";
    assert.equal(agPostalAddress("TX").address_line1, "P.O. Box 12548");
  });

  test("the table itself is frozen", () => {
    assert.equal(Object.isFrozen(AG_MAIL_BY_STATE), true);
    assert.equal(Object.isFrozen(AG_MAIL_UNRESOLVED), true);
    for (const rec of Object.values(AG_MAIL_BY_STATE)) {
      assert.equal(Object.isFrozen(rec), true);
      assert.equal(Object.isFrozen(rec.address), true);
    }
  });
});

describe("the letter names the office the envelope goes to", () => {
  test("a mailable state's office name is the addressee on the envelope", () => {
    for (const code of MAILABLE) {
      const ag = agForState(code);
      assert.equal(ag.mailable, true, `${code} should be mailable`);
      assert.equal(ag.office, agPostalAddress(code).company_name,
        `${code} names one office in the letter and mails to another`);
    }
  });

  test("Hawaii and Wisconsin are addressed to the agency that actually takes the complaint", () => {
    // Neither state's attorney general handles individual consumer complaints.
    assert.match(agForState("HI").office, /Office of Consumer Protection/);
    assert.doesNotMatch(agForState("HI").office, /Attorney General/i);
    assert.match(agForState("WI").office, /DATCP/);
    assert.doesNotMatch(agForState("WI").office, /Attorney General/i);
  });

  test("an unmailable state still produces a letter, and still says it is not mailable", () => {
    const ny = agForState("NY");
    assert.equal(ny.mailable, false);
    assert.ok(ny.office, "the complaint still needs an addressee to print");
    assert.equal(agForState("CT").mailable, false);
  });

  test("having a statute and being mailable are different questions", () => {
    // Hawaii: no statute on file, but a confirmed address.
    assert.equal(agForState("HI").known, false);
    assert.equal(agForState("HI").mailable, true);
    // New York: a statute on file, but no confirmed address.
    assert.equal(agForState("NY").known, true);
    assert.equal(agForState("NY").mailable, false);
  });

  test("no statute is invented for a state that has none", () => {
    assert.match(agForState("HI").statute, /Search/);
    assert.deepEqual(agForState("HI").cites, []);
  });
});

describe("the CFPB address is one address, not two", () => {
  test("the structured CFPB address matches the one the complaint itself prints", () => {
    for (const part of [
      CFPB_MAIL_ADDRESS.company_name,
      CFPB_MAIL_ADDRESS.address_line1,
      CFPB_MAIL_ADDRESS.address_city,
      CFPB_MAIL_ADDRESS.address_state,
      CFPB_MAIL_ADDRESS.address_zip
    ]) {
      assert.ok(CFPB_FILING.mail.includes(part),
        `${part} is not in the CFPB address the complaint prints: ${CFPB_FILING.mail}`);
    }
  });

  test("the CFPB address passes the same wholeness check as every state", () => {
    assert.match(CFPB_MAIL_ADDRESS.address_state, /^[A-Z]{2}$/);
    assert.match(CFPB_MAIL_ADDRESS.address_zip, ZIP);
    assert.match(deliveryLine(CFPB_MAIL_ADDRESS), /\d/);
    assert.ok(CFPB_MAIL_ADDRESS.address_city.trim().length >= 3);
  });
});
