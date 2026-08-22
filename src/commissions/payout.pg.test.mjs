// Postgres proof: earned → approved → paid on commission_ledger.
// Always rolls back. Never sends money.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { close, pool } from "../db.mjs";
import { approveCommissions, markCommissionsPaid } from "./payout.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

describe("commission payout status in Postgres", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  let client;
  let db;
  let orgId;
  let staffId;
  let ledgerId;

  before(async () => {
    client = await pool().connect();
    db = { query: (sql, params) => client.query(sql, params) };
    await client.query("BEGIN");

    orgId = (await db.query(
      `SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1`
    )).rows[0]?.id;
    assert.ok(orgId, "default org is required");

    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Payout Tester', 'owner', 'active') RETURNING id`,
      [orgId, `payout-tester-${Date.now()}@example.com`]
    )).rows[0].id;

    ledgerId = (await db.query(
      `INSERT INTO commission_ledger (
         org_id, staff_id, basis, amount, currency, status, stacking,
         rule_snapshot, source_event, idempotency_key, earned_at
       ) VALUES (
         $1, $2, 'front_end', 42.50, 'USD', 'earned', 'base',
         '{}'::jsonb, 'manual', $3, now()
       ) RETURNING id`,
      [orgId, staffId, `payout-test|${Date.now()}`]
    )).rows[0].id;
  });

  after(async () => {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    client.release();
    await close();
  });

  test("approve then mark paid records payout_ref without inventing amount", async () => {
    const approved = await approveCommissions(db, {
      orgId,
      ledgerIds: [ledgerId],
      staff: { id: staffId, name: "Payout Tester" }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.updated, 1);
    assert.equal(approved.rows[0].status, "approved");
    assert.equal(String(approved.rows[0].amount), "42.50");

    const paid = await markCommissionsPaid(db, {
      orgId,
      ledgerIds: [ledgerId],
      payoutRef: "TEST-ACH-42",
      staff: { id: staffId, name: "Payout Tester" }
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.updated, 1);
    assert.equal(paid.rows[0].status, "paid");
    assert.equal(paid.rows[0].payout_ref, "TEST-ACH-42");
    assert.equal(String(paid.rows[0].amount), "42.50");

    const row = (await db.query(
      `SELECT status, approved_by, paid_by, payout_ref, amount
         FROM commission_ledger WHERE id = $1`,
      [ledgerId]
    )).rows[0];
    assert.equal(row.status, "paid");
    assert.equal(row.payout_ref, "TEST-ACH-42");
    assert.equal(row.approved_by, "Payout Tester");
    assert.equal(row.paid_by, "Payout Tester");
  });

  test("cannot approve a paid row again", async () => {
    const again = await approveCommissions(db, {
      orgId,
      ledgerIds: [ledgerId],
      staff: { id: staffId, name: "Payout Tester" }
    });
    assert.equal(again.status, 200);
    assert.equal(again.updated, 0);
    assert.equal(again.skipped, 1);
  });
});
