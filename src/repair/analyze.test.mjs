import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { addressFromBusinessEntity, analyzeAndGenerate } from "./analyze.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fakeDb(handlers = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      for (const [re, rows] of Object.entries(handlers)) {
        if (new RegExp(re, "i").test(text)) {
          return { rows: typeof rows === "function" ? rows(text, params) : (rows || []) };
        }
      }
      return { rows: [] };
    }
  };
}

describe("addressFromBusinessEntity", () => {
  test("reads the soft-pull company street", () => {
    const addr = addressFromBusinessEntity({
      address_line1: "204 Horse Blvd",
      city: "Austin",
      state: "TX",
      postal_code: "78701"
    });
    assert.equal(addr.address_line1, "204 Horse Blvd");
    assert.equal(addr.address_city, "Austin");
    assert.equal(addr.address_state, "TX");
    assert.equal(addr.address_zip, "78701");
  });

  test("refuses an empty entity", () => {
    assert.equal(addressFromBusinessEntity({ city: "Austin" }), null);
    assert.equal(addressFromBusinessEntity(null), null);
  });
});

describe("analyzeAndGenerate", () => {
  test("letters already on file still refuse without a signed repair agreement", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM dispute_letters/i.test(c.sql)));
  });

  test("staff dispute authorization is enough when no signed contract exists", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true);
    assert.equal(r.letters.length, 1);
  });

  test("letters already on file succeed when a signed repair agreement exists", async () => {
    const db = fakeDb({
      "FROM contracts": [{ "?column?": 1 }],
      "FROM dispute_letters dl": [{
        id: "letter-1",
        bureau: "EQ",
        case_id: "case-1",
        body_text: "Dear Equifax",
        rule_ids: ["M2-005"]
      }],
      "FROM clients": [{ first_name: "Sim", last_name: "Repair" }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true);
    assert.equal(r.already_generated, true);
    assert.equal(r.letters.length, 1);
  });

  test("enroll without a signed repair agreement refuses before the credit file", async () => {
    const db = fakeDb({
      "FROM contracts": [],
      "FROM repair_programs": [{ program: "trial", rounds_cap: 2, status: "active" }],
      "FROM crs_results": [{ result: { bureausPulled: ["EQ"] } }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM crs_results/i.test(c.sql)));
  });

  test("no agreement still refuses before the credit file", async () => {
    const db = fakeDb({
      "FROM dispute_letters dl": [],
      "FROM client_consents": [],
      "FROM contracts": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: { bureausPulled: ["EQ"] } }]
    });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_authorization");
    assert.ok(!db.seen.some((c) => /FROM crs_results/i.test(c.sql)));
  });
});

/* OWNER DECISION, 2026-09-03 — "any derogatory deserves a letter, but only if
   they are in the correct offer path." These two tests are the whole rule: the
   same damaged credit file produces letters for a repair-path client and nothing
   for a client off that path. The Metro 2 engine finds no defect in this file, so
   every claim in the letter comes from the derogatory pass. */
describe("derogatory items and the offer path", () => {
  const DAMAGED_FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          }
        }],
        inquiries: [],
        tradelines: [{
          creditorName: "MIDLAND CREDIT MANAGEMENT",
          accountIdentifier: "SIM-MCM-6642",
          accountOpenedDate: "2024-02-20",
          accountReportedDate: "2026-08-28",
          accountOwnershipType: "Individual",
          accountStatusType: "Open",
          accountType: "Open",
          loanType: "CollectionAgencyAttorney",
          businessType: "Collection",
          currentRatingType: "CollectionOrChargeOff",
          currentBalanceAmount: "1840",
          pastDueAmount: "0",
          sourceType: "Experian"
        }]
      }
    }
  };

  function dbFor(tier, { agreement = false } = {}) {
    return fakeDb({
      // Order matters: the outcome_tier read must be matched before the
      // first_name/last_name read, and both are "FROM clients".
      "outcome_tier FROM clients": [{ outcome_tier: tier }],
      "first_name, last_name FROM clients": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM contracts": agreement ? [{ "?column?": 1 }] : [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: DAMAGED_FILE }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-1", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R1"
      }],
      "INSERT INTO dispute_items": [{ id: "item-1" }],
      "INSERT INTO dispute_letters": [{ id: "letter-1", bureau: "EX", case_id: "case-1" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("a repair-path client gets a letter for a collection the engine finds no defect in", async () => {
    const db = dbFor("REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
    assert.deepEqual(r.letters[0].ruleIds, ["DEROG-COLLECTION"]);
  });

  test("FUNDING_PLUS_REPAIR is a repair path too", async () => {
    const db = dbFor("FUNDING_PLUS_REPAIR");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });

  test("a funding-only client gets nothing, whatever the file holds", async () => {
    const db = dbFor("FULL_FUNDING");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_violations");
  });

  test("a signed repair agreement is a repair path even with no tier stamped", async () => {
    const db = dbFor(null, { agreement: true });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });
});
