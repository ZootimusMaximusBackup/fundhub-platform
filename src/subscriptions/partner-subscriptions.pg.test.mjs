// Partner subscriptions, against a real Postgres. Skipped without DATABASE_URL.
//
// Migration 271 is what lets a white-label PARTNER hold a subscription at all.
// Everything here is written as an attack on it rather than a demonstration
// that it works, because the failure modes are all silent:
//
//   * Postgres SKIPS an exclusion check when an indexed value is NULL. A
//     partner row has client_id NULL, so 075's `subscriptions_no_overlap`
//     never compares it to anything. If `subscriptions_partner_no_overlap` is
//     missing or loosened, a partner holds two live rows for the same add-on
//     and is billed twice, with no error raised anywhere.
//   * A composite foreign key with a NULL column is not checked, so a partner
//     row's card_id would otherwise be free to point at a client's instrument.
//   * The menu has to STACK (W6: "monthly, stack freely, cancel freely"), so a
//     constraint that is too tight is as wrong as one that is too loose.
//
// Fixtures are this file's own two partners and one client, deleted on the way
// out. Nothing here touches a real subscription: partner rows cascade from the
// partner, the client row cascades from the client.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { PARTNER_ADD_ONS } from "../config/offers.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG_A = "sub-partner-test-alpha";
const SLUG_B = "sub-partner-test-beta";

const CI = PARTNER_ADD_ONS.CREATIVE_INTELLIGENCE;
const DFY = PARTNER_ADD_ONS.DFY_MARKETING;
const LEAD = PARTNER_ADD_ONS.LEAD_FLOW;

describe("partner subscriptions", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, pA, pB, clientId;

  const insert = (cols, vals) =>
    db.query(
      `INSERT INTO subscriptions (${cols.join(", ")}) VALUES (${
        cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      vals
    );

  const addOn = (partnerId, tier, priceCents, extra = {}) =>
    insert(
      ["org_id", "partner_id", "tier", "price_cents",
        ...Object.keys(extra)],
      [org, partnerId, tier, priceCents, ...Object.values(extra)]
    );

  async function cleanup() {
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND last_name = 'SubPartnerFixture'`, [org]);
    await db.query(`DELETE FROM partners WHERE org_id = $1 AND slug = ANY($2)`, [org, [SLUG_A, SLUG_B]]);
  }

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    pA = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,'Sub Partner Alpha',$2,'active') RETURNING id`, [org, SLUG_A])).rows[0].id;
    pB = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status)
       VALUES ($1,'Sub Partner Beta',$2,'active') RETURNING id`, [org, SLUG_B])).rows[0].id;
    clientId = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name)
       VALUES ($1,'Sub','SubPartnerFixture') RETURNING id`, [org])).rows[0].id;
  });

  after(async () => {
    await cleanup();
    await close();
  });

  // ── the thing that was impossible before 271 ──

  test("a partner can hold a subscription", async () => {
    const r = await addOn(pA, CI.productCode, CI.priceCents);
    assert.ok(r.rows[0].id);
    const row = (await db.query(
      `SELECT client_id, partner_id, tier, price_cents, effective_to
         FROM subscriptions WHERE id = $1`, [r.rows[0].id])).rows[0];
    assert.equal(row.client_id, null);
    assert.equal(row.partner_id, pA);
    assert.equal(Number(row.price_cents), 29700, "the owner-set price, in integer cents");
    assert.equal(row.effective_to, null, "a new row is the live one");
  });

  test("exactly one owner — not both, not neither", async () => {
    await assert.rejects(
      () => insert(["org_id", "client_id", "partner_id", "tier"], [org, clientId, pB, "both"]),
      /subscriptions_client_or_partner_chk/,
      "a subscription billed to a client AND a partner has no answer to whose money it is");
    await assert.rejects(
      () => insert(["org_id", "tier"], [org, "orphan"]),
      /subscriptions_client_or_partner_chk/,
      "a subscription belonging to nobody bills nobody and still reads as live");
  });

  // ── the double-billing guard ──

  test("the same partner cannot hold two live rows for the same add-on", async () => {
    await assert.rejects(
      () => addOn(pA, CI.productCode, CI.priceCents),
      /subscriptions_partner_no_overlap/,
      "a double-submitted upgrade would write two live rows and bill the partner twice");
  });

  test("case and stray spaces do not buy a second live row", async () => {
    await assert.rejects(
      () => addOn(pA, `  ${CI.productCode.toUpperCase()} `, CI.priceCents),
      /subscriptions_partner_no_overlap/);
  });

  test("the menu stacks — a partner may hold all three add-ons at once", async () => {
    await addOn(pA, DFY.productCode, DFY.priceCents);
    await addOn(pA, LEAD.productCode, LEAD.priceCents);
    const { rows } = await db.query(
      `SELECT tier FROM subscriptions
        WHERE org_id = $1 AND partner_id = $2 AND effective_to IS NULL
        ORDER BY tier`, [org, pA]);
    assert.deepEqual(rows.map((r) => r.tier),
      [CI.productCode, DFY.productCode, LEAD.productCode].sort());
  });

  test("one partner's add-on does not block another partner's", async () => {
    const r = await addOn(pB, CI.productCode, CI.priceCents);
    assert.ok(r.rows[0].id);
  });

  test("a closed earlier version of the same add-on is fine — that is the version chain", async () => {
    const r = await insert(
      ["org_id", "partner_id", "tier", "price_cents", "effective_from", "effective_to"],
      [org, pA, CI.productCode, 19700,
        new Date(Date.now() - 730 * 86400000), new Date(Date.now() - 365 * 86400000)]);
    assert.ok(r.rows[0].id, "history must be able to sit behind the live row");
  });

  // ── the unknowns that must survive ──

  test("an unrecorded price stays NULL — it is not zero", async () => {
    const r = await insert(["org_id", "partner_id", "tier"], [org, pB, "price-not-recorded"]);
    const row = (await db.query(
      `SELECT price_cents FROM subscriptions WHERE id = $1`, [r.rows[0].id])).rows[0];
    assert.equal(row.price_cents, null,
      "NULL means nobody has recorded what this costs; 0 would read as a free plan somebody chose");
  });

  // ── the card hole ──

  test("a partner row cannot carry a card", async () => {
    await assert.rejects(
      () => addOn(pB, "with-a-card", 100, { card_id: "11111111-1111-4111-8111-111111111111" }),
      /subscriptions_partner_card_chk/,
      "subscriptions_card_fk is composite on (card_id, client_id) and is NOT enforced when " +
      "client_id is NULL, so without this check a partner row could point at a client's card");
  });

  // ── terms stay frozen ──

  test("a subscription cannot be moved to another partner", async () => {
    await assert.rejects(
      () => db.query(
        `UPDATE subscriptions SET partner_id = $1
          WHERE org_id = $2 AND partner_id = $3 AND tier = $4`,
        [pB, org, pA, LEAD.productCode]),
      /immutable/);
  });

  test("a partner price cannot be restated in place", async () => {
    await assert.rejects(
      () => db.query(
        `UPDATE subscriptions SET price_cents = 1
          WHERE org_id = $1 AND partner_id = $2 AND tier = $3`,
        [org, pA, LEAD.productCode]),
      /immutable/,
      "a price change must close the row and open a new one, or every past period is repriced");
  });

  test("the money state still moves on a live row", async () => {
    const r = await db.query(
      `UPDATE subscriptions SET status = 'past_due'
        WHERE org_id = $1 AND partner_id = $2 AND tier = $3 AND effective_to IS NULL`,
      [org, pA, LEAD.productCode]);
    assert.equal(r.rowCount, 1, "status, cancelled_at and the period window are not terms");
  });

  // ── nothing above weakened the client side ──

  test("one subscription per client at a time still holds", async () => {
    await insert(["org_id", "client_id", "tier"], [org, clientId, "client-plan"]);
    await assert.rejects(
      () => insert(["org_id", "client_id", "tier"], [org, clientId, "another-plan"]),
      /subscriptions_no_overlap/,
      "075's client guarantee must survive 271 untouched");
  });

  // ── the add-ons are sellable products ──

  test("every add-on in offers.mjs resolves to a products row at its owner-set price", async () => {
    for (const a of [CI, DFY, LEAD]) {
      const { rows } = await db.query(
        `SELECT code, category, default_price, default_success_fee_percent
           FROM products WHERE org_id = $1 AND lower(code) = $2`, [org, a.productCode]);
      assert.equal(rows.length, 1, `${a.productCode} has no products row`);
      assert.equal(Math.round(Number(rows[0].default_price) * 100), a.priceCents,
        `${a.productCode}: products.default_price and offers.mjs priceCents disagree`);
      assert.equal(rows[0].category, "partner_service");
      assert.notEqual(rows[0].category, "funding",
        "'funding' would make this a magnet for unmatched payments and pay commission on it");
      assert.equal(rows[0].default_success_fee_percent, null, "an add-on has no success fee");
    }
  });
});
