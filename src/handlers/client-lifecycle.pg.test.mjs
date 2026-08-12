// Real-Postgres integration test for the client-lifecycle handlers.
// SKIPS unless DATABASE_URL is set (so `npm test` stays green without a DB).
// Run live:  DATABASE_URL=postgres://... npm run migrate && DATABASE_URL=... npm test
//
// Proves the full chain on a real database: emit canonical events → handlers →
// domain rows in clients/transactions/crs_results, and that a replay() of the
// stored events does NOT double-write (idempotency at the SQL level).

import { test, before, after } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, replay, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register } from "./client-lifecycle.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL = "lifecycle_pg_test@example.com";

async function wipe() {
  // children first (transactions has no cascade), then the client.
  await db.query(`DELETE FROM transactions WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM crs_results  WHERE client_id IN (SELECT id FROM clients WHERE email=$1)`, [EMAIL]);
  await db.query(`DELETE FROM events WHERE payload->>'email' = $1`, [EMAIL]);
  await db.query(`DELETE FROM clients WHERE email=$1`, [EMAIL]);
}

before(async () => {
  if (!HAS_DB) return;
  _resetOrgCache();
  clearHandlers();
  register();
  await wipe();
});

after(async () => {
  if (!HAS_DB) return;
  await wipe();
  await close();
});

test("full journey persists to Postgres and replay is idempotent", { skip: !HAS_DB }, async () => {
  const P = (extra) => ({ email: EMAIL, ...extra });

  await emit(db, "entry.captured", P({ name: "Pat Tester", source: "clickfunnels" }), { idempotencyKey: "pg:entry" });
  await emit(db, "survey.submitted", P({
    answers: {
      cf_svy_why: "growth",
      clarity: "high",
      cf_svy_self_reported_fico: "750+",
      cf_svy_has_negatives: "No",
      cf_svy_has_business: "Yes",
      cf_svy_funding_target_amount: "$50k-$100k",
    },
  }), { idempotencyKey: "pg:survey" });
  await emit(db, "payment.received", P({ productName: "Business Financial Assessment", amount: 32, providerRef: "pg_txn_1", source: "commas" }), { idempotencyKey: "pg:pay" });
  await emit(db, "diagnostic.paid", P({}), { idempotencyKey: "pg:diag" });
  await emit(db, "decision.rendered", P({ outcomeTier: "FULL_FUNDING", fundingEstimate: 50000 }), { idempotencyKey: "pg:decision" });
  await emit(db, "analysis.completed", P({ outcomeTier: "FULL_FUNDING", scores: { ex: 720 } }), { idempotencyKey: "pg:analysis" });

  // --- assert domain state ---
  const c = (await db.query(`SELECT * FROM clients WHERE email=$1`, [EMAIL])).rows;
  assert.equal(c.length, 1, "exactly one client row");
  assert.equal(c[0].first_name, "Pat");
  assert.equal(c[0].outcome_tier, "FULL_FUNDING");
  assert.equal(c[0].custom_fields.crs_paid, true);
  assert.equal(c[0].custom_fields.cf_svy_why, "growth");
  assert.equal(c[0].custom_fields.cf_svy_self_reported_fico, "750+");
  assert.equal(Number(c[0].custom_fields.total_funding_estimate), 50000);

  const clientId = c[0].id;

  // Typed carbon-copy must land (RUN5 Phase 0 / RUN4 FAIL land:cf_svy_carbon_copy_typed).
  const ccf = (await db.query(
    `SELECT cf_svy_self_reported_fico, cf_svy_has_negatives, cf_svy_has_business, cf_svy_funding_target_amount
       FROM client_custom_fields WHERE client_id=$1`,
    [clientId]
  )).rows;
  assert.equal(ccf.length, 1, "client_custom_fields carbon-copy row");
  assert.equal(ccf[0].cf_svy_self_reported_fico, "750+");
  assert.equal(ccf[0].cf_svy_has_negatives, "No");
  assert.equal(ccf[0].cf_svy_has_business, "Yes");
  assert.equal(ccf[0].cf_svy_funding_target_amount, "$50k-$100k");

  const tx = (await db.query(`SELECT * FROM transactions WHERE client_id=$1`, [clientId])).rows;
  assert.equal(tx.length, 1, "one transaction");
  assert.equal(Number(tx[0].amount_paid), 32);

  const crs = (await db.query(`SELECT * FROM crs_results WHERE client_id=$1`, [clientId])).rows;
  assert.equal(crs.length, 1, "one crs_result");

  // --- replay every stored event: handlers must NOT double-write ---
  const r = await replay(db, {});
  assert.ok(r.dispatched >= 6, "replay re-dispatched the stored events");
  const tx2 = (await db.query(`SELECT count(*)::int n FROM transactions WHERE client_id=$1`, [clientId])).rows[0].n;
  const crs2 = (await db.query(`SELECT count(*)::int n FROM crs_results WHERE client_id=$1`, [clientId])).rows[0].n;
  const cc = (await db.query(`SELECT count(*)::int n FROM clients WHERE email=$1`, [EMAIL])).rows[0].n;
  assert.equal(tx2, 1, "replay did not duplicate the transaction");
  assert.equal(crs2, 1, "replay did not duplicate the crs_result");
  assert.equal(cc, 1, "replay did not duplicate the client");
});
