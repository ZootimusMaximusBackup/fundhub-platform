// Focused commission-chain checks against real Postgres.
// Every fixture and ledger write is inside one transaction that always rolls
// back. This file never charges a provider and never leaves database data.

import { after, before, describe, test } from "node:test";
import assert from "node:assert";
import { close, pool } from "../db.mjs";
import {
  ensureAttributions,
  onRoundFundedMoney,
  writeBackEndCommissions,
  writeFrontEndCommissions
} from "./money-chain.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SOLD_AT = "2026-08-20T12:00:00Z";

describe("commission money chain in Postgres", {
  skip: !HAS_DB ? "no DATABASE_URL" : false
}, () => {
  let client;
  let db;
  let orgId;
  let clientId;
  let closerId;
  let managerId;
  let repairProductId;
  let fundingProductId;

  before(async () => {
    client = await pool().connect();
    db = { query: (sql, params) => client.query(sql, params) };
    await client.query("BEGIN");

    orgId = (await db.query(
      `SELECT id FROM orgs WHERE is_default ORDER BY created_at LIMIT 1`
    )).rows[0]?.id;
    assert.ok(orgId, "default org is required");

    const rates = (await db.query(
      `SELECT role, sale_motion, percent, amount_basis
         FROM commission_rules
        WHERE org_id = $1
          AND effective_from = '2026-08-20T00:00:00Z'
          AND sale_motion IS NOT NULL
          AND active
        ORDER BY role, sale_motion`,
      [orgId]
    )).rows;
    assert.deepEqual(
      rates.map((r) => [r.role, r.sale_motion, Number(r.percent), r.amount_basis]),
      [
        ["closer", "downsell", 20, "paid_amount"],
        ["closer", "upsell", 20, "paid_amount"],
        ["sales_manager", "downsell", 5, "paid_amount"]
      ],
      "migration 248 must install only the three owner-set motion rates"
    );

    clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name)
       VALUES ($1, $2, 'Commission') RETURNING id`,
      [orgId, `commission-chain-${Date.now()}@example.com`]
    )).rows[0].id;
    closerId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Commission Closer', 'closer', 'active') RETURNING id`,
      [orgId, `commission-closer-${Date.now()}@example.com`]
    )).rows[0].id;
    managerId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1, $2, 'Commission Manager', 'sales_manager', 'active') RETURNING id`,
      [orgId, `commission-manager-${Date.now()}@example.com`]
    )).rows[0].id;

    const products = (await db.query(
      `SELECT code, id FROM products
        WHERE org_id = $1 AND code IN ('repair-bundle', 'card-stacking-dfy')`,
      [orgId]
    )).rows;
    repairProductId = products.find((p) => p.code === "repair-bundle")?.id;
    fundingProductId = products.find((p) => p.code === "card-stacking-dfy")?.id;
    assert.ok(repairProductId && fundingProductId, "seeded commission products are required");
  });

  after(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    await close();
  });

  async function createSale(motion, productId = repairProductId) {
    return (await db.query(
      `INSERT INTO sales (
         org_id, client_id, product_id, agreed_price, currency,
         sold_at, status, sale_motion
       ) VALUES ($1,$2,$3,1000,'USD',$4,'active',$5)
       RETURNING *`,
      [orgId, clientId, productId, SOLD_AT, motion]
    )).rows[0];
  }

  async function createPayment(sale, amount, motion) {
    return (await db.query(
      `INSERT INTO sale_payments (
         org_id, sale_id, product_id, sale_motion, kind, amount, paid_at,
         source_event_id
       ) VALUES ($1,$2,$3,$4,'installment',$5,$6,gen_random_uuid())
       RETURNING *`,
      [orgId, sale.id, sale.product_id, motion, amount, SOLD_AT]
    )).rows[0];
  }

  async function attribute(sale) {
    return ensureAttributions(db, {
      orgId,
      saleId: sale.id,
      event: {
        payload: { closerId, salesManagerId: managerId }
      }
    });
  }

  test("two downsell part-payments pay closer and manager once per receipt", async () => {
    const sale = await createSale("downsell");
    assert.equal((await attribute(sale)).written, 4);

    const first = await createPayment(sale, 400, "downsell");
    const second = await createPayment(sale, 600, "downsell");
    const event = {
      name: "payment.received",
      payload: { paidAt: SOLD_AT, saleMotion: "downsell" }
    };

    assert.equal((await writeFrontEndCommissions(db, {
      saleId: sale.id, payment: first, event
    })).inserted, 2);
    assert.equal((await writeFrontEndCommissions(db, {
      saleId: sale.id, payment: second, event
    })).inserted, 2);
    assert.equal((await writeFrontEndCommissions(db, {
      saleId: sale.id, payment: first, event
    })).inserted, 0, "replaying one receipt must not pay it twice");

    const rows = (await db.query(
      `SELECT staff_id, role, sale_payment_id, base_amount, amount, idempotency_key
         FROM commission_ledger
        WHERE sale_id = $1
        ORDER BY sale_payment_id, role`,
      [sale.id]
    )).rows;
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map((r) => r.idempotency_key)).size, 4);
    assert.deepEqual(
      rows.filter((r) => r.role === "closer").map((r) => Number(r.amount)).sort((a, b) => a - b),
      [80, 120]
    );
    assert.deepEqual(
      rows.filter((r) => r.role === "sales_manager").map((r) => Number(r.amount)).sort((a, b) => a - b),
      [20, 30]
    );
    assert.deepEqual(
      [...new Set(rows.map((r) => Number(r.base_amount)))].sort((a, b) => a - b),
      [400, 600]
    );
    assert.deepEqual(
      new Set(rows.map((r) => r.sale_payment_id)),
      new Set([first.id, second.id])
    );
  });

  test("upsell pays the closer only; no manager upsell rate is invented", async () => {
    const sale = await createSale("upsell");
    await attribute(sale);
    const payment = await createPayment(sale, 500, "upsell");
    const result = await writeFrontEndCommissions(db, {
      saleId: sale.id,
      payment,
      event: {
        name: "payment.received",
        payload: { paidAt: SOLD_AT, saleMotion: "upsell" }
      }
    });

    assert.equal(result.inserted, 1);
    assert.ok(result.warnings.some((w) =>
      w.code === "no_base_rule" && w.role === "sales_manager"
    ));
    const rows = (await db.query(
      `SELECT role, amount, base_amount, sale_payment_id
         FROM commission_ledger WHERE sale_id = $1`,
      [sale.id]
    )).rows;
    assert.deepEqual(rows.map((r) => r.role), ["closer"]);
    assert.equal(Number(rows[0].base_amount), 500);
    assert.equal(Number(rows[0].amount), 100);
    assert.equal(rows[0].sale_payment_id, payment.id);
  });

  test("funded commission uses funded_amount and refuses an approved-only round", async () => {
    const sale = await createSale(null, fundingProductId);
    await attribute(sale);
    const fundedRound = (await db.query(
      `INSERT INTO funding_rounds (
         org_id, client_id, round_number, status, approved_amount, funded_amount
       ) VALUES ($1,$2,71,'funded',90000,50000)
       RETURNING *`,
      [orgId, clientId]
    )).rows[0];
    await db.query(
      `INSERT INTO funding_round_sales (
         org_id, funding_round_id, sale_id, link_method
       ) VALUES ($1,$2,$3,'explicit')`,
      [orgId, fundedRound.id, sale.id]
    );

    const funded = await writeBackEndCommissions(db, {
      roundId: fundedRound.id,
      event: { name: "round.funded", payload: { fundedAt: SOLD_AT } }
    });
    assert.equal(funded.inserted, 2);
    const fundedRows = (await db.query(
      `SELECT role, base_amount, amount
         FROM commission_ledger WHERE funding_round_id = $1 ORDER BY role`,
      [fundedRound.id]
    )).rows;
    assert.deepEqual(fundedRows.map((r) => Number(r.base_amount)), [50000, 50000]);
    assert.deepEqual(fundedRows.map((r) => Number(r.amount)), [125, 125]);

    const missingRound = (await db.query(
      `INSERT INTO funding_rounds (
         org_id, client_id, round_number, status, approved_amount, funded_amount
       ) VALUES ($1,$2,72,'funded',90000,NULL)
       RETURNING *`,
      [orgId, clientId]
    )).rows[0];
    await db.query(
      `INSERT INTO funding_round_sales (
         org_id, funding_round_id, sale_id, link_method
       ) VALUES ($1,$2,$3,'explicit')`,
      [orgId, missingRound.id, sale.id]
    );
    const missing = await writeBackEndCommissions(db, {
      roundId: missingRound.id,
      event: { name: "round.funded", payload: { approvedAmount: 90000 } }
    });
    assert.equal(missing.inserted, 0);
    assert.ok(missing.warnings.some((w) => w.code === "missing_funded_amount"));

    const refused = await onRoundFundedMoney({
      name: "round.funded",
      orgId,
      clientId,
      payload: {
        fundingRoundId: missingRound.id,
        approvedAmount: 90000
      }
    }, db);
    assert.equal(refused.done, false);
    assert.equal(refused.reason, "missing_funded_amount");
    const stillMissing = (await db.query(
      `SELECT approved_amount, funded_amount FROM funding_rounds WHERE id = $1`,
      [missingRound.id]
    )).rows[0];
    assert.equal(Number(stillMissing.approved_amount), 90000);
    assert.equal(
      stillMissing.funded_amount,
      null,
      "approved amount stays separate and never becomes funded amount"
    );
  });
});
