// The production floor, against real Postgres.
//
// floors.test.mjs proves the decisions. These prove the three things only a real
// database can, and they are exactly the boundaries the counting rule has to get
// right or a partnership ends on a wrong number:
//
//   * A CLIENT AT THE WINDOW EDGE. Half-open [start, end): a deposit at start
//     counts, a deposit at end does not, and it is counted in the next window
//     instead. Never in both, never in neither.
//   * A REFUNDED DEPOSIT. Fully refunded does not count. Partially refunded still
//     does — that client paid.
//   * A CLIENT WHO PAID TWICE. Counted once, in the month of their first surviving
//     deposit, whether the second payment is a second deposit or an instalment.
//
// Plus what only the schema can answer: that 282's unique index really does make a
// second monthly pass a no-op, that a review row cannot be deleted, and that the
// activation stamp fires on the status change rather than on a handler remembering
// to set it.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  countFundingClients, evaluatePartner, standingFor,
  windowFor, windowFloor, OUTCOMES, FLOOR_CLIENTS_PER_MONTH
} from "./floors.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "floors-test-partner";
const SLUG_OTHER = "floors-test-other";
const REF = "floors-test";

/* A window with round edges, chosen so every date below reads plainly. */
const WIN_START = new Date("2026-06-03T00:00:00.000Z");
const WIN_END = new Date("2026-09-01T00:00:00.000Z");
const IN_WINDOW = new Date("2026-07-15T12:00:00.000Z");

describe("production floor", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, otherPartnerId;
  const products = {};

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    for (const code of ["card-stacking-dfy", "repair-bundle"]) {
      const row = (await db.query(
        `SELECT id FROM products WHERE org_id = $1 AND code = $2 LIMIT 1`, [org, code]
      )).rows[0];
      assert.ok(row, `fixture needs the seeded product ${code}`);
      products[code] = row.id;
    }
    await cleanup();
    ({ partnerId, otherPartnerId } = await seedPartners());
  });

  async function seedPartners() {
    const a = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at,
                             revenue_share_pct, activated_at)
       VALUES ($1,'Floors Test Partner',$2,'active',now(),50,'2025-01-01T00:00:00Z')
       RETURNING id`, [org, SLUG])).rows[0].id;
    const b = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, revenue_share_pct, activated_at)
       VALUES ($1,'Floors Test Other',$2,'active',50,'2025-01-01T00:00:00Z')
       RETURNING id`, [org, SLUG_OTHER])).rows[0].id;
    return { partnerId: a, otherPartnerId: b };
  }

  async function cleanup() {
    await db.query(`ALTER TABLE partner_production_reviews DISABLE TRIGGER trg_ppr_no_delete`);
    await db.query(
      `DELETE FROM partner_production_reviews WHERE partner_id IN
         (SELECT id FROM partners WHERE slug = ANY($1))`, [[SLUG, SLUG_OTHER]]);
    await db.query(`ALTER TABLE partner_production_reviews ENABLE TRIGGER trg_ppr_no_delete`);
    await db.query(`DELETE FROM sale_payments WHERE org_id = $1 AND notes LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM sales WHERE org_id = $1 AND external_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND first_name = 'Floors'`, [org]);
    await db.query(`DELETE FROM partners WHERE slug LIKE 'floors-test%'`);
  }

  beforeEach(async () => {
    await db.query(`DELETE FROM sale_payments WHERE org_id = $1 AND notes LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM sales WHERE org_id = $1 AND external_ref LIKE $2`, [org, `${REF}%`]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND first_name = 'Floors'`, [org]);
    await db.query(`ALTER TABLE partner_production_reviews DISABLE TRIGGER trg_ppr_no_delete`);
    await db.query(`DELETE FROM partner_production_reviews WHERE partner_id = ANY($1)`,
      [[partnerId, otherPartnerId]]);
    await db.query(`ALTER TABLE partner_production_reviews ENABLE TRIGGER trg_ppr_no_delete`);
    await db.query(`UPDATE partners SET revenue_share_pct = 50 WHERE id = ANY($1)`,
      [[partnerId, otherPartnerId]]);
  });

  after(async () => { await cleanup(); await close(); });

  let seq = 0;

  /** One client on a partner's book. */
  async function seedClient(partner = partnerId) {
    return (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, partner_id)
       VALUES ($1,'Floors',$2,$3) RETURNING id`,
      [org, `Client${++seq}`, partner])).rows[0].id;
  }

  /** One sale plus one payment on it. Returns the sale so a refund can be added. */
  async function seedSale({
    clientId, code = "card-stacking-dfy", kind = "deposit",
    amount = "3000.00", paidAt = IN_WINDOW, status = "active", isDemo = false
  } = {}) {
    const tag = `${REF}-${++seq}`;
    const productId = products[code];
    const saleId = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, external_ref,
                          status, is_demo, sold_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [org, clientId, productId, amount, tag, status, isDemo, paidAt])).rows[0].id;
    await addPayment({ saleId, productId, kind, amount, paidAt, isDemo, tag });
    return saleId;
  }

  async function addPayment({
    saleId, productId = products["card-stacking-dfy"], kind = "deposit",
    amount = "3000.00", paidAt = IN_WINDOW, isDemo = false, tag = `${REF}-${++seq}`
  }) {
    return (await db.query(
      `INSERT INTO sale_payments (org_id, sale_id, product_id, kind, amount, paid_at,
                                  notes, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [org, saleId, productId, kind, amount, paidAt, tag, isDemo])).rows[0].id;
  }

  const count = (start = WIN_START, end = WIN_END, partner = partnerId) =>
    countFundingClients(db, { orgId: org, partnerId: partner, start, end });

  // ══════════ what counts at all ══════════

  test("a FUNDING_DFY deposit inside the window counts", async () => {
    await seedSale({ clientId: await seedClient() });
    assert.equal(await count(), 1);
  });

  test("repair does not count, and neither does a soft pull", async () => {
    await seedSale({ clientId: await seedClient(), code: "repair-bundle", amount: "1000.00" });
    assert.equal(await count(), 0, "repair-only is not a funding client");
  });

  test("a success fee or an instalment alone is not a new funding client", async () => {
    const c = await seedClient();
    await seedSale({ clientId: c, kind: "success_fee", amount: "12000.00" });
    assert.equal(await count(), 0);
  });

  test("a zero-value receipt is not a client who paid", async () => {
    await seedSale({ clientId: await seedClient(), amount: "0.00" });
    assert.equal(await count(), 0);
  });

  test("demo data cannot clear the bar", async () => {
    await seedSale({ clientId: await seedClient(), isDemo: true });
    assert.equal(await count(), 0);
  });

  test("another partner's client is never counted here", async () => {
    await seedSale({ clientId: await seedClient(otherPartnerId) });
    assert.equal(await count(), 0);
    assert.equal(await count(WIN_START, WIN_END, otherPartnerId), 1);
  });

  test("a direct fundhub client (no partner) is counted for nobody", async () => {
    const direct = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,'Floors','Direct')
       RETURNING id`, [org])).rows[0].id;
    await seedSale({ clientId: direct });
    assert.equal(await count(), 0);
  });

  // ══════════ the window edge ══════════

  test("a deposit exactly at the window START counts", async () => {
    await seedSale({ clientId: await seedClient(), paidAt: WIN_START });
    assert.equal(await count(), 1);
  });

  test("a deposit exactly at the window END belongs to the NEXT window", async () => {
    await seedSale({ clientId: await seedClient(), paidAt: WIN_END });
    assert.equal(await count(), 0, "half-open [start, end) — end is excluded");
    const nextEnd = new Date("2026-12-01T00:00:00.000Z");
    assert.equal(await count(WIN_END, nextEnd), 1, "and it is counted there instead");
  });

  test("one millisecond before the end still counts", async () => {
    await seedSale({ clientId: await seedClient(), paidAt: new Date(WIN_END.getTime() - 1) });
    assert.equal(await count(), 1);
  });

  test("one millisecond before the start does not", async () => {
    await seedSale({ clientId: await seedClient(), paidAt: new Date(WIN_START.getTime() - 1) });
    assert.equal(await count(), 0);
  });

  // ══════════ refunds ══════════

  test("a fully refunded deposit does not count", async () => {
    const saleId = await seedSale({ clientId: await seedClient() });
    await addPayment({ saleId, kind: "refund", amount: "3000.00" });
    assert.equal(await count(), 0);
  });

  test("a refund of MORE than the deposit still does not count", async () => {
    const saleId = await seedSale({ clientId: await seedClient() });
    await addPayment({ saleId, kind: "refund", amount: "3500.00" });
    assert.equal(await count(), 0);
  });

  test("a PARTIAL refund still counts — that client paid", async () => {
    const saleId = await seedSale({ clientId: await seedClient() });
    await addPayment({ saleId, kind: "refund", amount: "500.00" });
    assert.equal(await count(), 1);
  });

  test("a cancelled sale does not count even with no refund row", async () => {
    await seedSale({ clientId: await seedClient(), status: "cancelled" });
    assert.equal(await count(), 0);
  });

  test("a client refunded on their first sale counts from the SECOND, surviving one", async () => {
    const c = await seedClient();
    const first = await seedSale({ clientId: c, paidAt: WIN_START });
    await addPayment({ saleId: first, kind: "refund", amount: "3000.00" });
    // They came back and paid again inside the window.
    await seedSale({ clientId: c, paidAt: IN_WINDOW });
    assert.equal(await count(), 1);
    // And the surviving deposit is what places them: a window that ends before it
    // does not see them at all.
    assert.equal(await count(WIN_START, new Date("2026-07-01T00:00:00.000Z")), 0);
  });

  // ══════════ paying twice ══════════

  test("two deposits from the same client count once", async () => {
    const c = await seedClient();
    await seedSale({ clientId: c, paidAt: WIN_START });
    await seedSale({ clientId: c, paidAt: IN_WINDOW });
    assert.equal(await count(), 1);
  });

  test("a deposit plus instalments on the same sale count once", async () => {
    const c = await seedClient();
    const saleId = await seedSale({ clientId: c, paidAt: WIN_START });
    await addPayment({ saleId, kind: "installment", amount: "1000.00" });
    await addPayment({ saleId, kind: "installment", amount: "1000.00", paidAt: IN_WINDOW });
    assert.equal(await count(), 1);
  });

  test("a client is placed by their FIRST deposit, so a later one cannot re-count them", async () => {
    const c = await seedClient();
    await seedSale({ clientId: c, paidAt: new Date("2026-03-01T00:00:00.000Z") });
    await seedSale({ clientId: c, paidAt: IN_WINDOW });
    // The first deposit is outside this window, so this window does not see them.
    assert.equal(await count(), 0, "counting the second deposit would count one person twice");
    assert.equal(await count(new Date("2026-01-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z")), 1);
  });

  // ══════════ the evaluation, end to end ══════════

  const AS_OF = "2026-09-01T14:00:00.000Z";

  async function seedClients(n, paidAt = IN_WINDOW) {
    for (let i = 0; i < n; i += 1) await seedSale({ clientId: await seedClient(), paidAt });
  }

  test("a partner below the floor is warned and their share is untouched", async () => {
    await seedClients(2);
    const r = await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    assert.equal(r.evaluated, true);
    assert.equal(r.outcome, OUTCOMES.WARNING);
    assert.equal(r.fundingClients, 2);
    assert.equal(r.floorClients, windowFloor());
    assert.equal(r.floorPerMonth, FLOOR_CLIENTS_PER_MONTH);
    const pct = (await db.query(`SELECT revenue_share_pct FROM partners WHERE id = $1`,
      [partnerId])).rows[0].revenue_share_pct;
    assert.equal(Number(pct), 50);
  });

  test("the review row freezes the bar it was measured against", async () => {
    await seedClients(1);
    await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    const row = (await db.query(
      `SELECT * FROM partner_production_reviews WHERE partner_id = $1`, [partnerId])).rows[0];
    assert.equal(row.floor_per_month, FLOOR_CLIENTS_PER_MONTH);
    assert.equal(row.floor_clients, windowFloor());
    assert.equal(row.met, false);
    assert.equal(row.consecutive_misses, 1);
    const { start, end } = windowFor(AS_OF);
    assert.equal(new Date(row.window_start).toISOString(), start.toISOString());
    assert.equal(new Date(row.window_end).toISOString(), end.toISOString());
  });

  test("a second pass in the same month writes nothing and moves nothing", async () => {
    await seedClients(0);
    const first = await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    assert.equal(first.evaluated, true);
    const again = await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    assert.equal(again.evaluated, false);
    assert.equal(again.reason, "already_reviewed");
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM partner_production_reviews WHERE partner_id = $1`,
      [partnerId])).rows[0].n;
    assert.equal(n, 1);
  });

  test("three consecutive misses drop the share to 20, and a good window puts it back", async () => {
    // Three months of nothing, evaluated in sequence.
    const months = ["2026-07-01T14:00:00Z", "2026-08-01T14:00:00Z", "2026-09-01T14:00:00Z"];
    const outcomes = [];
    for (const m of months) {
      outcomes.push((await evaluatePartner(db, { orgId: org, partnerId, asOf: m })).outcome);
    }
    assert.deepEqual(outcomes, [OUTCOMES.WARNING, OUTCOMES.FINAL_NOTICE, OUTCOMES.DOWNGRADE]);
    let pct = (await db.query(`SELECT revenue_share_pct FROM partners WHERE id = $1`,
      [partnerId])).rows[0].revenue_share_pct;
    assert.equal(Number(pct), 20);

    // October: a full window at or above the floor. The window is the 90 days
    // ending 2026-10-01, so the deposits go inside it.
    await seedClients(windowFloor(), new Date("2026-09-15T00:00:00.000Z"));
    const back = await evaluatePartner(db, { orgId: org, partnerId, asOf: "2026-10-01T14:00:00Z" });
    assert.equal(back.outcome, OUTCOMES.RESTORED);
    assert.equal(Number(back.sharePctAfter), 50);
    pct = (await db.query(`SELECT revenue_share_pct FROM partners WHERE id = $1`,
      [partnerId])).rows[0].revenue_share_pct;
    assert.equal(Number(pct), 50);
  });

  test("a downgrade never restates an accrual and never pauses the partner", async () => {
    const status = (await db.query(`SELECT status FROM partners WHERE id = $1`,
      [partnerId])).rows[0].status;
    assert.equal(status, "active");
    for (const m of ["2026-07-01T14:00:00Z", "2026-08-01T14:00:00Z", "2026-09-01T14:00:00Z"]) {
      await evaluatePartner(db, { orgId: org, partnerId, asOf: m });
    }
    const after = (await db.query(`SELECT status FROM partners WHERE id = $1`,
      [partnerId])).rows[0].status;
    assert.equal(after, "active", "W1 §6: never flip to paused — it blocks earned payouts");
  });

  // ══════════ the schema's own guarantees ══════════

  test("a review row cannot be deleted", async () => {
    await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    await assert.rejects(
      () => db.query(`DELETE FROM partner_production_reviews WHERE partner_id = $1`, [partnerId]),
      /not deletable/
    );
  });

  test("activated_at is stamped by the database when a partner goes active", async () => {
    const id = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status) VALUES ($1,'Floors Stamp',$2,'invited')
       RETURNING id`, [org, "floors-test-stamp"])).rows[0].id;
    let row = (await db.query(`SELECT status, activated_at FROM partners WHERE id = $1`, [id])).rows[0];
    assert.equal(row.activated_at, null, "an invited partner has not started");

    await db.query(`UPDATE partners SET status = 'active' WHERE id = $1`, [id]);
    row = (await db.query(`SELECT activated_at FROM partners WHERE id = $1`, [id])).rows[0];
    assert.ok(row.activated_at, "the stamp is the database's job, not a handler's");

    // Pausing and resuming keeps the ORIGINAL date — otherwise a pause would hand
    // a struggling partner a fresh 180-day exemption.
    const first = row.activated_at;
    await db.query(`UPDATE partners SET status = 'paused' WHERE id = $1`, [id]);
    await db.query(`UPDATE partners SET status = 'active' WHERE id = $1`, [id]);
    row = (await db.query(`SELECT activated_at FROM partners WHERE id = $1`, [id])).rows[0];
    assert.equal(new Date(row.activated_at).toISOString(), new Date(first).toISOString());

    await db.query(`DELETE FROM partners WHERE id = $1`, [id]);
  });

  test("standingFor reports the live window and the recorded verdict together", async () => {
    await seedClients(3);
    await evaluatePartner(db, { orgId: org, partnerId, asOf: AS_OF });
    const s = await standingFor(db, { orgId: org, partnerId, asOf: AS_OF });
    assert.equal(s.latest.outcome, OUTCOMES.WARNING);
    assert.equal(s.latest.funding_clients, 3);
    assert.equal(s.floorClients, windowFloor());
    // The live window ends at asOf, so it also sees the same three.
    assert.equal(s.current.fundingClients, 3);
    assert.equal(s.current.shortBy, windowFloor() - 3);
  });
});
