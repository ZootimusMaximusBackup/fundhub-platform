#!/usr/bin/env node
// Live proof: walk a Card Stacking card through four stages and print the rows.
// Usage: DATABASE_URL=… node scripts/prove-card-stacking-rounds.mjs
import { db, close } from "../src/db.mjs";
import { moveCardToStage } from "../src/workflows/cards.mjs";
import { register as registerMoneyChain } from "../src/handlers/money-chain.mjs";
import { clearHandlers } from "../src/events/registry.mjs";
import { _resetOrgCache } from "../src/events/bus.mjs";
import { resolveDefaultOrg } from "../src/auth/org.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const MARK = `prove_cs_${Date.now().toString(36)}`;

function show(title, rows) {
  console.log("\n=== " + title + " ===");
  if (!rows?.length) {
    console.log("(no rows)");
    return;
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function main() {
  _resetOrgCache();
  clearHandlers();
  registerMoneyChain();
  const orgId = await resolveDefaultOrg(db);

  const advisorId = (await db.query(
    `INSERT INTO staff (org_id, email, name, role, status)
     VALUES ($1, $2, 'Prove Advisor', 'funding_advisor', 'active') RETURNING id`,
    [orgId, `${MARK}@example.com`]
  )).rows[0].id;

  const clientId = (await db.query(
    `INSERT INTO clients (org_id, email, first_name, last_name, outcome_tier)
     VALUES ($1, $2, 'Prove', 'Client', 'FULL_FUNDING') RETURNING id`,
    [orgId, `${MARK}.client@example.com`]
  )).rows[0].id;

  const productId = (await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`,
    [orgId]
  )).rows[0].id;

  // Reuse existing back_end rules for this product (exclusion constraint).
  const saleId = (await db.query(
    `INSERT INTO sales (org_id, client_id, product_id, agreed_price, agreed_success_fee_percent, status, sold_at)
     VALUES ($1, $2, $3, 3000, 10, 'active', now()) RETURNING id`,
    [orgId, clientId, productId]
  )).rows[0].id;

  await db.query(
    `INSERT INTO sale_attributions (org_id, sale_id, staff_id, role, basis, split_percent)
     VALUES ($1, $2, $3, 'funding_advisor', 'back_end', 100)`,
    [orgId, saleId, advisorId]
  );

  const move = (stageKey, extra = {}) =>
    moveCardToStage(db, {
      orgId, clientId, pipelineKey: "funding_card_stacking", stageKey, ...extra
    });

  console.log("client_id=", clientId);
  console.log("Walking apply_now → round_submitted → approved → funded…");

  for (const stage of ["apply_now", "round_submitted", "approved"]) {
    const r = await move(stage);
    console.log(`move ${stage}: moved=${r.moved} event=${r.roundEvent?.eventName} deduped=${r.roundEvent?.deduped}`);
  }

  const round = (await db.query(
    `SELECT id, product, status, round_number, funded_amount, approved_amount
       FROM funding_rounds WHERE client_id = $1`,
    [clientId]
  )).rows[0];

  await db.query(
    `INSERT INTO applications (org_id, funding_round_id, client_id, bank, status, approved_amount)
     VALUES ($1, $2, $3, 'Bank A', 'Approved', 20000),
            ($1, $2, $3, 'Bank B', 'Approved', 15000)`,
    [orgId, round.id, clientId]
  );

  console.log("\n--- REFUSE funded with fundedAmount=0 ---");
  const refused = await move("funded", { fundedAmount: 0 });
  console.log(JSON.stringify({
    moved: refused.moved,
    reason: refused.reason,
    message: refused.message,
    suggestedFundedAmount: refused.suggestedFundedAmount
  }, null, 2));

  const stageAfterRefuse = (await db.query(
    `SELECT s.key FROM cards c JOIN pipeline_stages s ON s.id = c.stage_id
      WHERE c.client_id = $1`, [clientId]
  )).rows[0];
  console.log("card stage after refuse:", stageAfterRefuse?.key);

  console.log("\n--- Funded via Approved-apps prefill (no body amount) ---");
  const funded = await move("funded");
  console.log(JSON.stringify({
    moved: funded.moved,
    fundedAmount: funded.fundedAmount,
    event: funded.roundEvent?.eventName,
    deduped: funded.roundEvent?.deduped
  }, null, 2));

  show("funding_rounds", (await db.query(
    `SELECT id, product, status, round_number, funded_amount, approved_amount
       FROM funding_rounds WHERE client_id = $1`, [clientId]
  )).rows);

  show("funding_closeout", (await db.query(
    `SELECT id, funding_round_id, total_approved_amount, total_fee, balance_due, fee_percent, status
       FROM funding_closeout WHERE funding_round_id = $1`, [round.id]
  )).rows);

  show("commission_ledger (back_end)", (await db.query(
    `SELECT id, staff_id, basis, amount, funding_round_id
       FROM commission_ledger
      WHERE funding_round_id = $1 AND basis = 'back_end'`,
    [round.id]
  )).rows);

  show("round.* events", (await db.query(
    `SELECT name, idempotency_key, payload->>'product' AS product,
            payload->>'roundNumber' AS round_number,
            payload->>'fundedAmount' AS funded_amount
       FROM events WHERE client_id = $1 AND name LIKE 'round.%'
       ORDER BY created_at`,
    [clientId]
  )).rows);

  // Cleanup
  await db.query(`DELETE FROM funding_closeout_items WHERE funding_closeout_id IN (
    SELECT id FROM funding_closeout WHERE funding_round_id = $1)`, [round.id]).catch(() => {});
  await db.query(`DELETE FROM funding_closeout WHERE funding_round_id = $1`, [round.id]);
  await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
  try {
    await db.query(`DELETE FROM commission_ledger WHERE funding_round_id = $1`, [round.id]);
  } finally {
    await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`).catch(() => {});
  }
  await db.query(`DELETE FROM applications WHERE funding_round_id = $1`, [round.id]);
  await db.query(`DELETE FROM funding_round_sales WHERE funding_round_id = $1`, [round.id]);
  await db.query(`DELETE FROM funding_rounds WHERE id = $1`, [round.id]);
  await db.query(`DELETE FROM sale_attributions WHERE sale_id = $1`, [saleId]);
  await db.query(`DELETE FROM sales WHERE id = $1`, [saleId]);
  await db.query(`DELETE FROM cards WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM tasks WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM events WHERE client_id = $1`, [clientId]);
  await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await db.query(`DELETE FROM staff WHERE id = $1`, [advisorId]);

  await close();
  console.log("\n(cleaned up prove rows)");
}

main().catch(async (err) => {
  console.error(err);
  try { await close(); } catch { /* */ }
  process.exit(1);
});
