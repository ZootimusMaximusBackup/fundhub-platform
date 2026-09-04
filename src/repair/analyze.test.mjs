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
    /* The derogatory claim leads, and the personal-information floor
       (../metro2/diy/personal-info-floor.mjs) sits underneath it — owner-set
       2026-09-03, cleanup runs on every repair-path client on every round. This
       file carries no alias block and no address block, so the floor's two
       claims are the CONFIRM pair, never a fabricated second name. */
    assert.deepEqual(
      r.letters[0].ruleIds,
      ["DEROG-COLLECTION", "PI-NAME-CONFIRM", "PI-ADDRESS-CONFIRM"]
    );
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

/* OWNER DECISION, 2026-09-03, FINAL — the personal-information floor.
   "On EVERY customer on the credit-repair path, on EVERY round, clean file or
   not, ALWAYS run personal-information cleanup." So a spotless file on a
   repair-path client still produces a letter, and a client off that path still
   produces nothing from the same file. */
describe("the personal-information floor", () => {
  /* One bureau, one name, one address, one clean account, one inquiry from the
     creditor of that same account. Nothing here is disputable on its own: the
     Metro 2 engine finds no defect, there is no derogatory item, the name and
     address do not vary and the inquiry is explained by an account on the file. */
  const SPOTLESS_FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [{ firstName: "Sim", middleName: null, lastName: "Repair" }],
          addresses: [{
            addressLine1: "412 Pecan St", city: "Austin", state: "TX",
            postalCode: "78701", borrowerResidencyType: "Current",
            dateReported: "2026-08-01"
          }],
          ssns: [],
          employments: []
        }],
        inquiries: [{
          creditorName: "EXAMPLE BANK NA", inquiryDate: "2026-08-01",
          businessType: "Banking", sourceType: "Experian"
        }],
        tradelines: [{
          creditorName: "EXAMPLE BANK NA",
          accountIdentifier: "5121080011112222",
          accountOpenedDate: "2019-06-12",
          accountReportedDate: "2026-09-01",
          accountOwnershipType: "Individual",
          accountStatusType: "Open",
          accountType: "Revolving",
          currentRatingType: "AsAgreed",
          currentBalanceAmount: "1842",
          pastDueAmount: "0",
          sourceType: "Experian"
        }]
      }
    }
  };

  function dbFor(file, tier) {
    return fakeDb({
      "outcome_tier FROM clients": [{ outcome_tier: tier }],
      "first_name, last_name FROM clients": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [],
      "FROM crs_results": [{ result: file }],
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

  test("a spotless file on a repair client still produces a cleanup letter", async () => {
    const db = dbFor(SPOTLESS_FILE, "REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
    assert.deepEqual(
      r.letters[0].ruleIds.slice().sort(),
      ["PI-ADDRESS-CONFIRM", "PI-NAME-CONFIRM"]
    );
  });

  test("the same spotless file off the repair path produces nothing", async () => {
    const db = dbFor(SPOTLESS_FILE, "FULL_FUNDING");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_violations");
  });

  test("one name on the file is never disputed as a second name", async () => {
    const db = dbFor(SPOTLESS_FILE, "REPAIR_ONLY");
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.ok(!/PI-NAME-CONSOLIDATE/.test(r.letters[0].body_text),
      "a file carrying one name must never be told it carries more than one");
  });
});

/* OWNER RULE, 2026-09-03 — "re-pull the credit file before each round and drop
   from the next round whatever has already been removed." Dropping what was
   removed is automatic: every claim is computed from the newest stored pull, so
   a deleted item is simply not there. The re-pull is not automatic, so Round 2
   and later refuse until a newer pull is on record. */
describe("the re-pull gate between rounds", () => {
  const FILE = {
    bureausPulled: ["EX"],
    bureaus: {
      EX: {
        creditFiles: [{
          creditFileDetail: {
            creditFileInfileDate: "2026-09-03",
            creditFileResultStatusType: "FileReturned",
            sourceType: "Experian"
          },
          aliases: [{ firstName: "Sim", lastName: "Repair" }],
          addresses: [], ssns: [], employments: []
        }],
        inquiries: [],
        tradelines: []
      }
    }
  };

  /* Key order matters: the MAX(created_at) read must be matched before the
     round-letters read, because both queries name `dispute_letters dl`. */
  function dbFor({ pulledAt, priorRoundAt }) {
    return fakeDb({
      "MAX\\(dl\\.created_at\\)": [{ newest: priorRoundAt }],
      "outcome_tier FROM clients": [{ outcome_tier: "REPAIR_ONLY" }],
      "first_name, last_name FROM clients": [{ first_name: "Sim", last_name: "Repair" }],
      "FROM contracts": [],
      "FROM client_consents": [{ is_valid: true }],
      "FROM dispute_letters dl": [],
      "FROM repair_programs": [{ program: "full", rounds_cap: 6, status: "active" }],
      "FROM crs_results": [{ result: FILE, created_at: pulledAt }],
      "FROM dispute_cases dc": [],
      "INSERT INTO dispute_cases": [{
        id: "case-2", org_id: ORG, client_id: CLIENT, bureau: "EX", round: "R2"
      }],
      "INSERT INTO dispute_items": [{ id: "item-2" }],
      "INSERT INTO dispute_letters": [{ id: "letter-2", bureau: "EX", case_id: "case-2" }],
      "FROM dispute_letters$": [],
      "SELECT body_text FROM dispute_letters": []
    });
  }

  test("Round 2 on the same file Round 1 was written from is refused", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "credit_file_stale_for_round");
  });

  test("a fresh pull clears it — the refusal is not a lock", async () => {
    const db = dbFor({ pulledAt: "2026-08-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.letters.length, 1);
  });

  test("Round 1 is never blocked — there is no earlier round to be stale against", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: "2026-07-01T00:00:00Z" });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R1" });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  test("a client with no earlier round is not blocked", async () => {
    const db = dbFor({ pulledAt: "2026-06-01T00:00:00Z", priorRoundAt: null });
    const r = await analyzeAndGenerate(db, { orgId: ORG, clientId: CLIENT, round: "R2" });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});
