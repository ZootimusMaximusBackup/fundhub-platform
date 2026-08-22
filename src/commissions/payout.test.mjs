// Unit tests for commission approve / mark-paid (no live money movement).
import test from "node:test";
import assert from "node:assert/strict";
import {
  approveCommissions,
  markCommissionsPaid
} from "./payout.mjs";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEDGER_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEDGER_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STAFF = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Owner Chris" };

function fakeDb(handlers) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        if (h.match(sql)) return h.reply(sql, params);
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    }
  };
}

test("approveCommissions: refuses empty ledger_ids", async () => {
  const db = fakeDb([]);
  const out = await approveCommissions(db, { orgId: ORG, ledgerIds: [], staff: STAFF });
  assert.equal(out.status, 400);
  assert.equal(out.error, "ledger_ids_required");
  assert.equal(db.calls.length, 0);
});

test("approveCommissions: updates earned rows and skips bad ids", async () => {
  const db = fakeDb([
    {
      match: (sql) => /UPDATE commission_ledger/.test(sql) && /status = 'approved'/.test(sql),
      reply: (_sql, params) => {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], [LEDGER_A]);
        assert.equal(params[2], "Owner Chris");
        return {
          rows: [{
            id: LEDGER_A,
            staff_id: STAFF.id,
            client_id: null,
            amount: "100.00",
            currency: "USD",
            status: "approved",
            approved_at: "2026-08-22T12:00:00Z",
            approved_by: "Owner Chris"
          }]
        };
      }
    },
    {
      match: (sql) => /INSERT INTO events/.test(sql),
      reply: () => ({ rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] })
    }
  ]);

  const out = await approveCommissions(db, {
    orgId: ORG,
    ledgerIds: [LEDGER_A, "not-a-uuid", LEDGER_A],
    staff: STAFF
  });

  assert.equal(out.status, 200);
  assert.equal(out.updated, 1);
  assert.equal(out.requested, 1);
  assert.equal(out.skipped, 0);
  assert.equal(out.rows[0].status, "approved");
});

test("markCommissionsPaid: requires payout_ref", async () => {
  const db = fakeDb([]);
  const out = await markCommissionsPaid(db, {
    orgId: ORG,
    ledgerIds: [LEDGER_A],
    payoutRef: "  ",
    staff: STAFF
  });
  assert.equal(out.status, 400);
  assert.equal(out.error, "payout_ref_required");
});

test("markCommissionsPaid: only moves approved rows", async () => {
  const db = fakeDb([
    {
      match: (sql) => /UPDATE commission_ledger/.test(sql) && /status = 'paid'/.test(sql),
      reply: (_sql, params) => {
        assert.equal(params[3], "ACH-9911");
        assert.deepEqual(params[1], [LEDGER_A, LEDGER_B]);
        return {
          rows: [{
            id: LEDGER_A,
            staff_id: STAFF.id,
            client_id: null,
            amount: "100.00",
            currency: "USD",
            status: "paid",
            paid_at: "2026-08-22T12:05:00Z",
            paid_by: "Owner Chris",
            payout_ref: "ACH-9911"
          }]
        };
      }
    },
    {
      match: (sql) => /INSERT INTO events/.test(sql),
      reply: () => ({ rows: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }] })
    }
  ]);

  const out = await markCommissionsPaid(db, {
    orgId: ORG,
    ledgerIds: [LEDGER_A, LEDGER_B],
    payoutRef: "ACH-9911",
    staff: STAFF
  });

  assert.equal(out.status, 200);
  assert.equal(out.updated, 1);
  assert.equal(out.skipped, 1);
  assert.equal(out.payout_ref, "ACH-9911");
  assert.equal(out.rows[0].status, "paid");
});
