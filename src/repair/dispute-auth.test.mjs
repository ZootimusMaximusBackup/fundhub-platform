import { test, describe } from "node:test";
import assert from "node:assert";
import { hasDisputeAuthorization, hasRepairAgreement } from "./dispute-auth.mjs";

function fakeDb(rows = []) {
  const calls = [];
  const queue = [...rows];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return queue.length ? queue.shift() : { rows: [] };
    }
  };
}

describe("hasDisputeAuthorization", () => {
  test("missing org is false and issues no query", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { clientId: "c" }), false);
    assert.deepEqual(db.calls, []);
  });

  test("missing client is false and issues no query", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o" }), false);
    assert.deepEqual(db.calls, []);
  });

  test("asks hasValidConsent for kind dispute_authorization", async () => {
    const db = fakeDb([{ rows: [] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o", clientId: "c" }), false);
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].params[2], "dispute_authorization");
  });

  test("true when a valid consent row is on file", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasDisputeAuthorization(db, { orgId: "o", clientId: "c" }), true);
  });
});

describe("hasRepairAgreement", () => {
  test("true from dispute_authorization consent", async () => {
    const db = fakeDb([{ rows: [{ is_valid: true }] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), true);
    assert.equal(db.calls.length, 1);
  });

  test("true from a signed repair contract when consent is missing", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [{ "?column?": 1 }] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), true);
    assert.equal(db.calls.length, 2);
    assert.match(db.calls[1].text, /FROM contracts/i);
  });

  test("true from an active repair program when consent and contract are missing", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [] }, { rows: [{ "?column?": 1 }] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), true);
    assert.match(db.calls[2].text, /FROM repair_programs/i);
  });

  test("false when nothing is on file", async () => {
    const db = fakeDb([{ rows: [] }, { rows: [] }, { rows: [] }]);
    assert.equal(await hasRepairAgreement(db, { orgId: "o", clientId: "c" }), false);
  });
});
