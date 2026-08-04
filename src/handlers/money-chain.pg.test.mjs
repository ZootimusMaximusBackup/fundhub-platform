// Postgres integration for money-chain writers.
// SKIPS unless DATABASE_URL is set.
//
// Proves: each writer fires once per event, replay does not duplicate, and the
// read APIs (commissions / entitlements / funding-rounds) return the written rows.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { emit, replay, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerLifecycle } from "./client-lifecycle.mjs";
import { register as registerMoneyChain } from "./money-chain.mjs";
import { createSession } from "../auth/session.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "moneychain_pg";
const EMAIL = `${MARK}@example.com`;

describe("money-chain writers", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, closerId, advisorId, handler, ownerToken;
  let fundingProductId, diagProductId, diyProductId;
  let frontRuleId, backRuleId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1 OR first_name = $2`,
      [`${MARK}%`, MARK]
    )).rows.map((r) => r.id);
    if (clients.length) {
      await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`);
      try {
        await db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clients]);
      } finally {
        await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`);
      }
      await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
      try {
        await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [clients]);
      } finally {
        await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`);
      }
      await db.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM sale_attributions WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_round_sales WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
      await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [clients]);
      await db.query(`DELETE FROM events WHERE client_id = ANY($1) OR payload->>'email' LIKE $2`, [clients, `${MARK}%`]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
    }
    if (frontRuleId) {
      await db.query(`DELETE FROM commission_rules WHERE id = ANY($1)`, [[frontRuleId, backRuleId].filter(Boolean)]);
    }
    if (org) {
      await db.query(
        `DELETE FROM product_entitlements WHERE org_id = $1 AND product_code IN ('diagnostic','consulting-package','card-stacking-dfy')`,
        [org]
      );
    }
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${MARK}%`]);
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    registerLifecycle();
    registerMoneyChain();

    org = await resolveDefaultOrg(db);
    await wipe();

    closerId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Money Chain Closer','closer','active') RETURNING id`,
      [org, `${MARK}.closer@example.com`]
    )).rows[0].id;
    advisorId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Money Chain Advisor','funding_advisor','active') RETURNING id`,
      [org, `${MARK}.advisor@example.com`]
    )).rows[0].id;

    fundingProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy'`, [org]
    )).rows[0].id;
    diagProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'diagnostic'`, [org]
    )).rows[0].id;
    diyProductId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'consulting-package'`, [org]
    )).rows[0].id;

    frontRuleId = (await db.query(
      `INSERT INTO commission_rules (
         org_id, name, basis, stacking, role, product_id,
         calc_method, flat_amount, amount_basis, effective_from, active
       ) VALUES (
         $1, 'MC closer flat deposit', 'front_end', 'base', 'closer', $2,
         'flat', 500.00, 'deposit_collected', '2020-01-01', true
       ) RETURNING id`,
      [org, fundingProductId]
    )).rows[0].id;

    backRuleId = (await db.query(
      `INSERT INTO commission_rules (
         org_id, name, basis, stacking, role, product_id,
         calc_method, percent, amount_basis, effective_from, active
       ) VALUES (
         $1, 'MC advisor 0.25% funded', 'back_end', 'base', 'funding_advisor', $2,
         'percent', 0.25, 'amount_funded', '2020-01-01', true
       ) RETURNING id`,
      [org, fundingProductId]
    )).rows[0].id;

    await db.query(
      `INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
       VALUES
         ($1, 'diagnostic', 'credit-analysis-report'),
         ($1, 'consulting-package', 'metro2-letter-pack'),
         ($1, 'card-stacking-dfy', 'funding-snapshot')
       ON CONFLICT DO NOTHING`,
      [org]
    );

    const owner = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org]
    )).rows[0];
    ownerToken = (await createSession(db, { staffId: owner.id, orgId: owner.org_id })).token;
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
  });

  after(async () => {
    await wipe();
    await close();
  });

  const call = async (path) =>
    handler(new Request("https://x" + path, {
      headers: { authorization: "Bearer " + ownerToken, host: "x" }
    }), {});
  const json = async (r) => JSON.parse(await r.text());

  test("deposit.paid writes sale + payment + front-end ledger; replay does not duplicate", async () => {
    const payload = {
      email: EMAIL,
      name: "Money Chain Client",
      product: "deposit",
      productName: "Consulting Services Deposit",
      amount: 3000,
      providerRef: `${MARK}_dep_1`,
      closerId,
      source: "commas"
    };

    await emit(db, "payment.received", payload, {
      orgId: org, idempotencyKey: `${MARK}:pay1`
    });
    await emit(db, "deposit.paid", payload, {
      orgId: org, idempotencyKey: `${MARK}:dep1`
    });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [EMAIL])).rows[0];
    assert.ok(client, "client created");

    const sales = (await db.query(
      `SELECT * FROM sales WHERE client_id = $1 AND product_id = $2`,
      [client.id, fundingProductId]
    )).rows;
    assert.equal(sales.length, 1, "exactly one sale");
    assert.equal(Number(sales[0].agreed_price), 3000);

    const pays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1`, [sales[0].id]
    )).rows;
    assert.ok(pays.length >= 1, "at least one sale_payment");
    assert.ok(pays.some((p) => p.kind === "deposit" && Number(p.amount) === 3000));

    const attrs = (await db.query(
      `SELECT * FROM sale_attributions WHERE sale_id = $1 AND basis = 'front_end'`,
      [sales[0].id]
    )).rows;
    assert.equal(attrs.length, 1);
    assert.equal(attrs[0].staff_id, closerId);

    const ledger = (await db.query(
      `SELECT * FROM commission_ledger WHERE sale_id = $1 AND basis = 'front_end'`,
      [sales[0].id]
    )).rows;
    assert.equal(ledger.length, 1, "one front-end ledger row");
    assert.equal(Number(ledger[0].amount), 500);
    assert.equal(ledger[0].staff_id, closerId);

    const ents = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1 AND revoked_at IS NULL`,
      [client.id]
    )).rows;
    assert.ok(ents.some((e) => e.entitlement_code === "funding-snapshot"));

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [client.id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM commission_ledger WHERE sale_id = $1`, [sales[0].id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sales[0].id])).rows[0].n,
      pays.length
    );

    const commRes = await call(`/api/read/commissions?client_id=${client.id}`);
    assert.equal(commRes.status, 200);
    const commBody = await json(commRes);
    const items = commBody.items || [];
    assert.ok(items.some((i) => Number(i.amount) === 500 && i.basis === "front_end"),
      "GET /api/read/commissions returns the written ledger row");

    const entRes = await call(`/api/read/entitlements?client_id=${client.id}`);
    assert.equal(entRes.status, 200);
    const entBody = await json(entRes);
    const entItems = entBody.items || [];
    assert.ok(
      entItems.some((i) => i.entitlement_code === "funding-snapshot"),
      "GET /api/read/entitlements returns the grant"
    );
  });

  test("diagnostic.paid and sale.closed each write exactly one sale; replay safe", async () => {
    const diagEmail = `${MARK}.diag@example.com`;
    const diyEmail = `${MARK}.diy@example.com`;

    await emit(db, "payment.received", {
      email: diagEmail, product: "crs", productName: "Business Financial Assessment",
      amount: 32, providerRef: `${MARK}_diag_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diag-pay` });
    await emit(db, "diagnostic.paid", {
      email: diagEmail, product: "crs", productName: "Business Financial Assessment",
      amount: 32, providerRef: `${MARK}_diag_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diag` });

    await emit(db, "payment.received", {
      email: diyEmail, product: "diy", productName: "Consulting Services Package",
      amount: 1000, providerRef: `${MARK}_diy_1`, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diy-pay` });
    await emit(db, "sale.closed", {
      email: diyEmail, product: "diy", productName: "Consulting Services Package",
      amount: 1000, providerRef: `${MARK}_diy_1`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:diy` });

    const diagClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [diagEmail])).rows[0].id;
    const diyClient = (await db.query(`SELECT id FROM clients WHERE email = $1`, [diyEmail])).rows[0].id;

    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1 AND product_id = $2`,
        [diagClient, diagProductId])).rows[0].n, 1);
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1 AND product_id = $2`,
        [diyClient, diyProductId])).rows[0].n, 1);

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [diagClient])).rows[0].n, 1);
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sales WHERE client_id = $1`, [diyClient])).rows[0].n, 1);

    const diagEnt = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [diagClient]
    )).rows;
    assert.ok(diagEnt.some((e) => e.entitlement_code === "credit-analysis-report"));

    const diyEnt = (await db.query(
      `SELECT entitlement_code FROM entitlements WHERE client_id = $1`, [diyClient]
    )).rows;
    assert.ok(diyEnt.some((e) => e.entitlement_code === "metro2-letter-pack"));
  });

  test("round.started freezes funding_round_sales; round.funded writes back-end ledger once", async () => {
    const email = `${MARK}.fund@example.com`;
    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 3000, providerRef: `${MARK}_fund_dep`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:fund-pay` });
    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 3000, providerRef: `${MARK}_fund_dep`, closerId, advisorId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:fund-dep` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    const sale = (await db.query(
      `SELECT id FROM sales WHERE client_id = $1 AND product_id = $2 ORDER BY sold_at DESC LIMIT 1`,
      [client.id, fundingProductId]
    )).rows[0];
    assert.ok(sale);

    await emit(db, "round.started", {
      email, roundNumber: 1, saleId: sale.id, advisorId
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:rnd-start` });

    const rounds = (await db.query(
      `SELECT * FROM funding_rounds WHERE client_id = $1`, [client.id]
    )).rows;
    assert.equal(rounds.length, 1, "one funding round");
    assert.equal(rounds[0].round_number, 1);

    const links = (await db.query(
      `SELECT * FROM funding_round_sales WHERE funding_round_id = $1`, [rounds[0].id]
    )).rows;
    assert.equal(links.length, 1, "round→sale link frozen");
    assert.equal(links[0].sale_id, sale.id);

    await emit(db, "round.funded", {
      email, roundNumber: 1, fundingRoundId: rounds[0].id,
      fundedAmount: 50000, approvedAmount: 50000, advisorId
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:rnd-fund` });

    const funded = (await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1`, [rounds[0].id]
    )).rows[0];
    assert.equal(funded.status, "funded");
    assert.equal(Number(funded.funded_amount), 50000);

    const back = (await db.query(
      `SELECT * FROM commission_ledger
        WHERE funding_round_id = $1 AND basis = 'back_end'`,
      [rounds[0].id]
    )).rows;
    assert.equal(back.length, 1, "one back-end ledger row");
    assert.equal(back[0].staff_id, advisorId);
    assert.equal(Number(back[0].amount), 125);

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM funding_rounds WHERE client_id = $1`, [client.id])).rows[0].n,
      1
    );
    assert.equal(
      (await db.query(
        `SELECT count(*)::int n FROM commission_ledger WHERE funding_round_id = $1 AND basis = 'back_end'`,
        [rounds[0].id]
      )).rows[0].n,
      1
    );

    const frRes = await call(`/api/read/funding-rounds?client_id=${client.id}`);
    assert.equal(frRes.status, 200);
    const frBody = await json(frRes);
    const frItems = frBody.items || [];
    assert.ok(
      frItems.some((r) => r.id === rounds[0].id && Number(r.funded_amount) === 50000),
      "GET /api/read/funding-rounds returns the written round"
    );

    const commRes = await call(`/api/read/commissions?client_id=${client.id}`);
    const commBody = await json(commRes);
    const items = commBody.items || [];
    assert.ok(items.some((i) => i.basis === "back_end" && Number(i.amount) === 125));
  });

  test("payment.received against an existing sale writes sale_payments once on replay", async () => {
    const email = `${MARK}.install@example.com`;
    await emit(db, "deposit.paid", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 1500, providerRef: `${MARK}_inst_dep`, closerId, source: "commas"
    }, { orgId: org, idempotencyKey: `${MARK}:inst-dep` });

    const client = (await db.query(`SELECT id FROM clients WHERE email = $1`, [email])).rows[0];
    const sale = (await db.query(
      `SELECT id FROM sales WHERE client_id = $1 ORDER BY sold_at DESC LIMIT 1`, [client.id]
    )).rows[0];

    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 500, providerRef: `${MARK}_inst_2`, source: "commas"
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:inst-pay2` });

    const pays = (await db.query(
      `SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY paid_at`, [sale.id]
    )).rows;
    assert.ok(pays.length >= 2, `expected >=2 payments, got ${pays.length}`);

    const nBefore = pays.length;
    await emit(db, "payment.received", {
      email, product: "deposit", productName: "Consulting Services Deposit",
      amount: 500, providerRef: `${MARK}_inst_2`, source: "commas"
    }, { orgId: org, clientId: client.id, idempotencyKey: `${MARK}:inst-pay2` });
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sale.id])).rows[0].n,
      nBefore
    );

    await replay(db, {});
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM sale_payments WHERE sale_id = $1`, [sale.id])).rows[0].n,
      nBefore
    );
  });
});
