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
