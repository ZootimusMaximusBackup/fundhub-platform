// Refunds and chargebacks reaching the partner ledger, against real Postgres.
//
// The unit tests in money-chain-reversal.test.mjs prove the routing. These prove
// the three things only a real database can:
//
//   1. THE WHOLE WIRE. A payment accrues, a refund event arrives carrying only
//      the processor's reference, and the partner's accrual ends up void — with
//      no hand-fed transaction id anywhere in the test. That is the hole this
//      unit closes: voidForRefund() existed and nothing called it.
//   2. THE VOID IS A VOID. The row survives, the reason names the refund, and
//      the payable balance drops to nothing.
//   3. THE PARTIAL REFUND IS ALL-OR-NOTHING. A partial refund is two writes —
//      void the old row, write the survivor — and half of that pair is a real
//      loss. withTransaction() puts them in one BEGIN/COMMIT on this handle, so
//      a failure on the second write must roll the first one back. That is
//      asserted here by making the second write fail on purpose.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { accrueForPayment, voidForRefund } from "../partners/revenue.mjs";
import { onPaymentRefundedMoney, onPaymentDisputedMoney } from "./money-chain.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "reversal-test-partner";
const REF = "reversal-test";

describe("refund and chargeback reversal", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, partnerClient;
  let productId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    productId = (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = 'card-stacking-dfy' LIMIT 1`,
      [org])).rows[0].id;
    assert.ok(productId, "fixture needs the seeded card-stacking-dfy product");
    await cleanup();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at, revenue_share_pct)
       VALUES ($1,'Reversal Test Partner',$2,'active',now(),50) RETURNING id`,
      [org, SLUG])).rows[0].id;
    partnerClient = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, partner_id)
       VALUES ($1,'Reversal','Partnered',$2) RETURNING id`, [org, partnerId])).rows[0].id;
  });

  async function cleanup() {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(
      `DELETE FROM partner_revenue WHERE partner_id IN
         (SELECT id FROM partners WHERE slug = $1)`, [SLUG]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM sale_payments WHERE org_id = $1 AND notes LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM sales WHERE org_id = $1 AND external_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM transactions WHERE org_id = $1 AND provider_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM events WHERE org_id = $1 AND idempotency_key LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND first_name = 'Reversal'`, [org]);
    await db.query(`DELETE FROM partners WHERE slug = $1`, [SLUG]);
  }

  beforeEach(async () => {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM partner_revenue WHERE partner_id = $1`, [partnerId]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = $1`, [partnerId]);
  });

  after(async () => { await cleanup(); await close(); });

  let seq = 0;
  /** A settled payment wired the way the money chain wires one: a transactions
   *  row keyed by the processor's reference, an events row, a sale, a payment. */
  async function seedPayment({ amount = "3000.00" } = {}) {
    const tag = `${REF}-${++seq}`;
    const transactionId = (await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status,
                                 provider, provider_ref, raw_payload)
       VALUES ($1,$2,'card-stacking-dfy',$3,'succeeded','commas',$4,'{}'::jsonb) RETURNING id`,
      [org, partnerClient, amount, tag])).rows[0].id;
    const eventId = (await db.query(
      `INSERT INTO events (org_id, name, client_id, payload, idempotency_key)
       VALUES ($1,'payment.received',$2,'{}'::jsonb,$3) RETURNING id`,
      [org, partnerClient, tag])).rows[0].id;
    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, external_ref)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [org, partnerClient, productId, amount, tag])).rows[0].id;
    const paymentId = (await db.query(
      `INSERT INTO sale_payments (org_id, sale_id, transaction_id, product_id, kind,
                                  amount, notes, source_event_id)
       VALUES ($1,$2,$3,$4,'deposit',$5,$6,$7) RETURNING id`,
      [org, saleId, transactionId, productId, amount, tag, eventId])).rows[0].id;
    return { tag, saleId, paymentId, transactionId, eventId };
  }

  /** A reversal event exactly as processCommasInboxRow builds one: the only
   *  identity it carries is the processor's reference. */
  function reversalEvent(name, tag, amount) {
    return {
      id: null,
      name,
      orgId: org,
      clientId: partnerClient,
      payload: {
        providerRef: tag,
        paymentId: tag,
        amount,
        productName: "Consulting Services Deposit",
        source: "commas"
      }
    };
  }

  const accruals = () => db.query(
    `SELECT * FROM partner_revenue WHERE partner_id = $1 ORDER BY created_at, id`,
    [partnerId]
  ).then((r) => r.rows);

  test("a refund event, carrying only the processor's reference, voids the accrual", async () => {
    const { tag, paymentId } = await seedPayment();
    const acc = await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });
    assert.equal(acc.accrued, true);

    const out = await onPaymentRefundedMoney(reversalEvent("payment.refunded", tag, 3000), db);

    assert.equal(out.reversed, true);
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 0, "a full refund leaves nothing to re-accrue");

    const rows = await accruals();
    assert.equal(rows.length, 1, "the accrual must survive as a voided row, never a delete");
    assert.equal(rows[0].status, "void");
    assert.equal(rows[0].void_reason, `refund:${tag}`);

    const bal = (await db.query(
      `SELECT balance_accrued FROM v_partner_balance WHERE partner_id = $1`, [partnerId])).rows[0];
    assert.equal(Number(bal.balance_accrued), 0,
      "the whole point: a refunded deal must stop being payable");
  });

  test("a partial refund leaves the survivor accrued at the rate the original froze", async () => {
    const { tag, paymentId } = await seedPayment();
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    // Downgrade the partner before the refund lands. The survivor must still be
    // computed at 50 — the rate the original accrual froze.
    await db.query(`UPDATE partners SET revenue_share_pct = 20 WHERE id = $1`, [partnerId]);

    const out = await onPaymentRefundedMoney(reversalEvent("payment.refunded", tag, 1000), db);
    assert.equal(out.voided, 1);
    assert.equal(out.reaccrued, 1);

    const rows = await accruals();
    assert.equal(rows.length, 2);
    const survivor = rows.find((r) => r.status === "accrued");
    assert.ok(survivor, "the surviving $2,000 must still be on the partner's book");
    assert.equal(survivor.gross_amount, "2000.00");
    assert.equal(survivor.share_amount, "1000.00");
    assert.equal(Number(survivor.share_pct_applied), 50);
    assert.equal(survivor.transaction_id, null,
      "the voided row still owns the transaction key");
  });

  test("a chargeback voids too, and the reason says so", async () => {
    // There is no dispute.won event, so a won chargeback is found by this prefix
    // and corrected by hand. See the block comment in money-chain.mjs.
    const { tag, paymentId } = await seedPayment();
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    const out = await onPaymentDisputedMoney(reversalEvent("payment.disputed", tag, 3000), db);
    assert.equal(out.voided, 1);
    const rows = await accruals();
    assert.equal(rows[0].status, "void");
    assert.equal(rows[0].void_reason, `chargeback:${tag}`);
  });

  test("the same refund delivered twice reverses once", async () => {
    const { tag, paymentId } = await seedPayment();
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    await onPaymentRefundedMoney(reversalEvent("payment.refunded", tag, 1000), db);
    const second = await onPaymentRefundedMoney(reversalEvent("payment.refunded", tag, 1000), db);

    assert.equal(second.reversed, false);
    assert.equal(second.reason, "nothing_to_void");
    assert.equal((await accruals()).length, 2, "a re-delivery must not mint a third row");
  });

  test("a refund whose payment we never saw touches nothing", async () => {
    const { paymentId } = await seedPayment();
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    const out = await onPaymentRefundedMoney(
      reversalEvent("payment.refunded", `${REF}-never-seen`, 3000), db);

    assert.equal(out.reversed, false);
    assert.equal(out.reason, "no_original_payment");
    const rows = await accruals();
    assert.equal(rows[0].status, "accrued",
      "matching by amount instead would eventually reverse somebody else's deal");
  });

  // ══════════ the two writes are one write ══════════

  test("a partial refund whose re-accrual fails rolls the void back", async () => {
    /* THE GAP THIS CLOSES. Void and re-accrue are two statements. Before
       withTransaction() they ran under autocommit, so a failure on the second
       left the accrual void and the surviving money gone from the partner's
       book, with no retry possible — the void had already landed and a second
       call reports "nothing_to_void".

       The failure is forced by asking for a survivor too large for
       numeric(14,2), which makes the INSERT raise inside the transaction. */
    const { tag, paymentId } = await seedPayment();
    await accrueForPayment(db, { orgId: org, salePaymentId: paymentId });

    const transactionId = (await db.query(
      `SELECT id FROM transactions WHERE org_id = $1 AND provider_ref = $2`,
      [org, tag])).rows[0].id;

    await assert.rejects(() => voidForRefund(db, {
      orgId: org,
      transactionId,
      reason: `refund:${tag}`,
      netRemainingCents: 100_000_000_000_000
    }));

    const rows = await accruals();
    assert.equal(rows.length, 1, "the failed re-accrual must not have been written");
    assert.equal(rows[0].status, "accrued",
      "the void must have rolled back with it — half a reversal is a real loss");
  });
});
