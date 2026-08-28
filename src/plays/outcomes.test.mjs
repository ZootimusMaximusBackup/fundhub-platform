import test from "node:test";
import assert from "node:assert/strict";
import { outcomeFromStatus, listOutcomesForLaterPlays } from "./outcomes.mjs";

test("outcomeFromStatus maps Approved/Denied only", () => {
  assert.equal(outcomeFromStatus("Approved"), "yes");
  assert.equal(outcomeFromStatus("Denied"), "no");
  assert.equal(outcomeFromStatus("Apply"), null);
  assert.equal(outcomeFromStatus("Applied"), null);
  assert.equal(outcomeFromStatus(""), null);
});

test("listOutcomesForLaterPlays reads yes/no even with no play name", async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /application_decisions/);
      assert.match(sql, /Approved/);
      assert.match(sql, /Denied/);
      assert.doesNotMatch(sql, /d\.play_name IS NOT NULL/);
      assert.equal(params[0], "11111111-1111-4111-8111-111111111111");
      assert.equal(params[1], "33333333-3333-4333-8333-333333333333");
      return {
        rows: [{
          id: "dec-1",
          application_id: "app-1",
          status: "Denied",
          play_name: null,
          decided_at: "2026-08-26T07:51:21.280Z",
          client_id: params[1],
          lender_id: "44444444-4444-4444-8444-444444444444",
          bank: "American Express"
        }]
      };
    }
  };
  const rows = await listOutcomesForLaterPlays(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "33333333-3333-4333-8333-333333333333"
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, "no");
  assert.equal(rows[0].bank, "American Express");
  assert.equal(rows[0].play_name, null);
});

test("listOutcomesForLaterPlays can read an org with no client filter", async () => {
  const db = {
    async query(sql, params) {
      assert.doesNotMatch(sql, /a\.client_id =/);
      assert.equal(params.length, 2);
      return {
        rows: [{
          id: "dec-2",
          application_id: "app-2",
          status: "Approved",
          play_name: "Card stack",
          decided_at: "2026-08-26T08:00:00.000Z",
          client_id: "33333333-3333-4333-8333-333333333333",
          lender_id: null,
          bank: "Chase"
        }]
      };
    }
  };
  const rows = await listOutcomesForLaterPlays(db, {
    orgId: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(rows[0].outcome, "yes");
  assert.equal(rows[0].play_name, "Card stack");
});
