// Postgres-backed tests for affiliate economics. Skipped without DATABASE_URL.
//
// The four rules under test: first touch is immutable, accrual only on completed
// outcomes, tier 2 unlocks one-way, and NO RATE IS INVENTED when no rule matches
// (owner-set defaults live in migration 261: 20% direct / 5% downline).

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import {
  attribute, qualifyingOutcome, findRule, commissionFor, basisFor,
  convert, maybeUnlockTier2, voidReferral, unratedConversions,
  FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES, TIER
} from "./economics.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TAG = "econ-test";

describe("affiliate economics", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, affA, affB, recruiter, client1, client2, fundingProduct, repairProduct, diagProduct;

  const mkClient = async (name) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1,$2,$3) RETURNING id`,
    [org, TAG, name])).rows[0].id;

  const mkAffiliate = async (name, recruitedBy = null) => (await db.query(
    `INSERT INTO affiliates (org_id, name, status, recruited_by)
     VALUES ($1,$2,'active',$3) RETURNING id`, [org, `${TAG}-${name}`, recruitedBy])).rows[0].id;

  const mkSale = async (clientId, productId, price = 1000) => (await db.query(
    `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at)
     VALUES ($1,$2,$3,$4,'active',now()) RETURNING id`,
    [org, clientId, productId, price])).rows[0].id;

  const productId = async (code) => (await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND code = $2`, [org, code])).rows[0].id;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    fundingProduct = await productId(FUNDING_PRODUCT_CODES[0]);
    repairProduct = await productId(REPAIR_PRODUCT_CODES[0]);
    diagProduct = await productId("diagnostic");
    await wipe();
  });

  async function wipe() {
    // Referrals FK to rules (rule_id), so referrals go FIRST or the rule delete
    // is rejected. Ordering, not a schema problem.
    // 033 blocks DELETE on affiliate_referrals — an attribution is evidence, and
    // that guard is exactly what test 2 relies on. Lift it for the fixture reset
    // only, the same way the dead-letter and partner suites do.
    await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
    await db.query(`DELETE FROM affiliate_referrals WHERE org_id = $1`, [org]);
    await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
    // Keep owner-set AF-04 rows (migration 260). Only clear fixture rules this suite inserts.
    await db.query(
      `DELETE FROM affiliate_commission_rules
        WHERE org_id = $1
          AND (notes IS NULL OR notes NOT LIKE 'Owner-set 2026-08-24 AF-04%')`,
      [org]
    );
    await db.query(
      `UPDATE affiliate_commission_rules
          SET active = true, updated_at = now()
        WHERE org_id = $1 AND notes LIKE 'Owner-set 2026-08-24 AF-04%'`,
      [org]
    );
    await db.query(`DELETE FROM sale_payments WHERE sale_id IN
                     (SELECT id FROM sales WHERE client_id IN
                        (SELECT id FROM clients WHERE first_name = $1))`, [TAG]);
    await db.query(`DELETE FROM funding_rounds WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM sales WHERE client_id IN
                     (SELECT id FROM clients WHERE first_name = $1)`, [TAG]);
    await db.query(`DELETE FROM clients WHERE first_name = $1`, [TAG]);
    await db.query(`DELETE FROM affiliates WHERE org_id = $1 AND name LIKE $2`, [org, `${TAG}-%`]);
  }

  beforeEach(async () => {
    await wipe();
    recruiter = await mkAffiliate("recruiter");
    affA = await mkAffiliate("A", recruiter);   // A was recruited BY recruiter
    affB = await mkAffiliate("B");
    client1 = await mkClient("One");
    client2 = await mkClient("Two");
  });

  after(async () => { await wipe(); await close(); });

  // ══════════ RULE 1: first touch is immutable ══════════

  test("first touch attributes, and a replay is a no-op not a duplicate", async () => {
    const a = await attribute(db, { orgId: org, affiliateId: affA, clientId: client1,
      trackingIdUsed: "AFF-1", source: "clickfunnels" });
    assert.equal(a.attributed, true);
    const b = await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    assert.equal(b.attributed, false);
    assert.equal(b.reason, "already_attributed");
    assert.equal(b.referralId, a.referralId);

    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM affiliate_referrals WHERE client_id = $1 AND tier = 'direct'`,
      [client1]);
    assert.equal(rows[0].n, 1);
  });

  test("ATTACK: a second affiliate cannot steal an existing attribution", async () => {
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const steal = await attribute(db, { orgId: org, affiliateId: affB, clientId: client1 });
    assert.equal(steal.attributed, false);
    assert.equal(steal.reason, "owned_by_other");
    assert.equal(steal.ownedBy, affA);

    const owner = (await db.query(
      `SELECT affiliate_id FROM affiliate_referrals WHERE client_id = $1 AND tier = 'direct'`,
      [client1])).rows[0];
    assert.equal(owner.affiliate_id, affA, "STOLEN: the attribution moved");
  });

  test("direct and downline are separate slots on one client", async () => {
    assert.equal((await attribute(db, { orgId: org, affiliateId: affA, clientId: client1,
      tier: "direct" })).attributed, true);
    assert.equal((await attribute(db, { orgId: org, affiliateId: recruiter, clientId: client1,
      tier: "downline" })).attributed, true);
    const { rows } = await db.query(
      `SELECT tier FROM affiliate_referrals WHERE client_id = $1 ORDER BY tier`, [client1]);
    assert.deepEqual(rows.map((r) => r.tier), ["direct", "downline"]);
  });

  test("attribute validates its arguments", async () => {
    await assert.rejects(() => attribute(db, { orgId: org, clientId: client1 }), /required/);
    await assert.rejects(
      () => attribute(db, { orgId: org, affiliateId: affA, clientId: client1, tier: "sideways" }),
      /tier must be/);
  });

  // ══════════ RULE 2: completed outcomes only ══════════

  test("a funding sale with NO funded round does not qualify", async () => {
    const sale = await mkSale(client1, fundingProduct);
    const q = await qualifyingOutcome(db, { orgId: org, clientId: client1, saleId: sale });
    assert.equal(q.qualifies, false);
    assert.equal(q.reason, "funding_not_completed",
      "a signed deal that never funded is not an outcome");
  });

  test("a funding sale WITH a funded round qualifies", async () => {
    const sale = await mkSale(client1, fundingProduct);
    await db.query(
      `INSERT INTO funding_rounds (org_id, client_id, round_number, funded_amount, status)
       VALUES ($1,$2,1,50000,'funded')`, [org, client1]);
    const q = await qualifyingOutcome(db, { orgId: org, clientId: client1, saleId: sale });
    assert.equal(q.qualifies, true);
    assert.equal(q.kind, "funded_engagement");
  });

  test("a repair enrolment qualifies; the diagnostic does not", async () => {
    const repair = await mkSale(client1, repairProduct);
    assert.equal((await qualifyingOutcome(db, { orgId: org, clientId: client1, saleId: repair })).kind,
      "repair_enrolment");
    const diag = await mkSale(client2, diagProduct);
    const q = await qualifyingOutcome(db, { orgId: org, clientId: client2, saleId: diag });
    assert.equal(q.qualifies, false);
    assert.match(q.reason, /not_qualifying:diagnostic/);
  });

  test("routing is by product code, never by amount", async () => {
    // A cheap funding sale and an expensive diagnostic must route on CODE.
    const cheapFunding = await mkSale(client1, fundingProduct, 1);
    await db.query(`INSERT INTO funding_rounds (org_id, client_id, round_number, funded_amount, status)
                    VALUES ($1,$2,1,10,'funded')`, [org, client1]);
    assert.equal((await qualifyingOutcome(db, { orgId: org, clientId: client1, saleId: cheapFunding }))
      .qualifies, true);
    const dearDiag = await mkSale(client2, diagProduct, 99999);
    assert.equal((await qualifyingOutcome(db, { orgId: org, clientId: client2, saleId: dearDiag }))
      .qualifies, false);
  });

  test("convert with no attribution earns nothing", async () => {
    const sale = await mkSale(client1, repairProduct);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });
    assert.equal(r.converted, false);
    assert.equal(r.reason, "no_attribution");
  });

  // ══════════ RULE 4: no rate is invented when nothing matches ══════════

  test("a conversion with no matching rule earns NULL, not zero", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1500);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });

    assert.equal(r.converted, true);
    assert.equal(r.unrated, true, "an unconfigured schedule must be reported, not defaulted");

    const row = (await db.query(
      `SELECT status, commission_due, rule_id FROM affiliate_referrals WHERE client_id = $1`,
      [client1])).rows[0];
    assert.equal(row.status, "converted");
    assert.equal(row.commission_due, null, "a missing rate became a number");
    assert.equal(row.rule_id, null);

    const gaps = await unratedConversions(db, { orgId: org });
    assert.equal(gaps.length, 1);
  });

  test("with no active rule matching, findRule and commissionFor stay null", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    assert.equal(await findRule(db, { orgId: org, tier: "direct" }), null);
    assert.equal(commissionFor(null, 1000), null, "no rule must not yield 0");
  });

  test("owner-set schedule rates a repair conversion at 20% of sale price", async () => {
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1000);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });

    assert.equal(r.converted, true);
    assert.equal(r.unrated, false);
    const row = (await db.query(
      `SELECT commission_due, basis_amount, rule_snapshot FROM affiliate_referrals
        WHERE client_id = $1 AND tier = 'direct'`, [client1])).rows[0];
    assert.equal(Number(row.commission_due), 200); // 20% of 1000
    assert.equal(Number(row.basis_amount), 1000);
    assert.equal(Number(row.rule_snapshot.percent), 20);
  });

  test("once a rule is configured, the commission is computed from it", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'direct 12pc','direct','percent',12,'sale_price','first_paid_product')`,
      [org]);

    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1500);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });

    assert.equal(r.unrated, false);
    const row = (await db.query(
      `SELECT commission_due, basis_amount, rule_snapshot FROM affiliate_referrals
        WHERE client_id = $1`, [client1])).rows[0];
    assert.equal(Number(row.commission_due), 180);       // 12% of 1500
    assert.equal(Number(row.basis_amount), 1500);
    assert.equal(Number(row.rule_snapshot.percent), 12);
  });

  test("the rule snapshot means a later rate change cannot restate history", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    const ruleId = (await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'r','direct','percent',10,'sale_price','first_paid_product') RETURNING id`,
      [org])).rows[0].id;
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1000);
    await convert(db, { orgId: org, clientId: client1, saleId: sale });

    await db.query(`UPDATE affiliate_commission_rules SET percent = 30 WHERE id = $1`, [ruleId]);
    const row = (await db.query(
      `SELECT commission_due, rule_snapshot FROM affiliate_referrals WHERE client_id = $1`,
      [client1])).rows[0];
    assert.equal(Number(row.commission_due), 100, "history was restated");
    assert.equal(Number(row.rule_snapshot.percent), 10);
  });

  test("a more specific rule wins: affiliate override beats tier default", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'tier default','direct','percent',10,'sale_price','first_paid_product')`, [org]);
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, affiliate_id, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'A override','direct',$2,'percent',25,'sale_price','first_paid_product')`,
      [org, affA]);

    const forA = await findRule(db, { orgId: org, tier: "direct", affiliateId: affA });
    assert.equal(forA.name, "A override");
    const forB = await findRule(db, { orgId: org, tier: "direct", affiliateId: affB });
    assert.equal(forB.name, "tier default");
  });

  test("a deactivated rule does not pay", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule, active)
       VALUES ($1,'retired','direct','percent',10,'sale_price','first_paid_product',false)`,
      [org]);
    assert.equal(await findRule(db, { orgId: org, tier: "direct" }), null,
      "a rule switched off must not keep accruing");
  });

  test("an expired or not-yet-effective rule does not pay", async () => {
    await db.query(
      `UPDATE affiliate_commission_rules SET active = false WHERE org_id = $1`, [org]);
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule,
          effective_from, effective_to)
       VALUES ($1,'expired','direct','percent',10,'sale_price','first_paid_product',
               now() - interval '30 days', now() - interval '1 day')`, [org]);
    assert.equal(await findRule(db, { orgId: org, tier: "direct" }), null, "expired rule paid");

    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule, effective_from)
       VALUES ($1,'future','direct','percent',20,'sale_price','first_paid_product',
               now() + interval '30 days')`, [org]);
    assert.equal(await findRule(db, { orgId: org, tier: "direct" }), null,
      "a rule effective next month paid today");

    // …and asOf can reach it deliberately, for a backdated recalculation.
    const later = await findRule(db, { orgId: org, tier: "direct",
      asOf: new Date(Date.now() + 40 * 86400000) });
    assert.equal(later.name, "future");
  });

  test("flat and percent both compute, and rounding is to cents", () => {
    assert.equal(commissionFor({ calc_method: "flat", flat_amount: 250 }, 9999).amount, 250);
    assert.equal(commissionFor({ calc_method: "percent", percent: 12.5 }, 1000).amount, 125);
    assert.equal(commissionFor({ calc_method: "percent", percent: 7.77 }, 333.33).amount, 25.90);
    assert.equal(commissionFor({ calc_method: "nonsense" }, 100), null);
  });

  test("basisFor implements each documented basis", async () => {
    const sale = await mkSale(client1, repairProduct, 1500);
    await db.query(`INSERT INTO sale_payments (org_id, sale_id, kind, amount)
                    VALUES ($1,$2,'deposit',500), ($1,$2,'installment',400),
                           ($1,$2,'refund',100)`, [org, sale]);
    assert.equal(await basisFor(db, { amountBasis: "sale_price", saleId: sale }), 1500);
    assert.equal(await basisFor(db, { amountBasis: "deposit_collected", saleId: sale }), 500);
    assert.equal(await basisFor(db, { amountBasis: "cash_collected", saleId: sale }), 900,
      "refunds must be excluded");
    assert.equal(await basisFor(db, { amountBasis: "first_payment", saleId: sale }), 500);
    await assert.rejects(() => basisFor(db, { amountBasis: "vibes", saleId: sale }),
      /unknown amount_basis/);
  });

  // ══════════ idempotency ══════════

  test("converting the same sale twice accrues once", async () => {
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, tier, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'r','direct','percent',10,'sale_price','first_paid_product')`, [org]);
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1000);

    const first = await convert(db, { orgId: org, clientId: client1, saleId: sale });
    const again = await convert(db, { orgId: org, clientId: client1, saleId: sale });
    assert.equal(first.converted, true);
    assert.equal(again.converted, false);
    assert.equal(again.results[0].reason, "already_converted");

    const row = (await db.query(
      `SELECT commission_due FROM affiliate_referrals WHERE client_id = $1`, [client1])).rows[0];
    assert.equal(Number(row.commission_due), 100, "a replay doubled the commission");
  });

  // ══════════ RULE 3: tier 2 ══════════

  test("tier 2 unlocks on a recruited affiliate", async () => {
    // `recruiter` already has affA recruited under them by the fixture.
    const before = (await db.query(`SELECT tier_level FROM affiliates WHERE id = $1`,
      [recruiter])).rows[0];
    assert.equal(before.tier_level, TIER.ONE);

    const u = await maybeUnlockTier2(db, { orgId: org, affiliateId: recruiter });
    assert.equal(u.unlocked, true);
    assert.equal(u.reason, "recruited_affiliate");

    const after = (await db.query(
      `SELECT tier_level, tier2_unlocked_at FROM affiliates WHERE id = $1`, [recruiter])).rows[0];
    assert.equal(after.tier_level, TIER.TWO);
    assert.ok(after.tier2_unlocked_at);
  });

  test("tier 2 unlocks on a first FUNDED referral", async () => {
    await attribute(db, { orgId: org, affiliateId: affB, clientId: client1 });
    const sale = await mkSale(client1, fundingProduct, 5000);
    await db.query(`INSERT INTO funding_rounds (org_id, client_id, round_number, funded_amount, status)
                    VALUES ($1,$2,1,50000,'funded')`, [org, client1]);

    assert.equal((await db.query(`SELECT tier_level FROM affiliates WHERE id=$1`, [affB]))
      .rows[0].tier_level, TIER.ONE);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });
    assert.deepEqual(r.tier2Unlocked, [affB]);
    assert.equal((await db.query(`SELECT tier_level FROM affiliates WHERE id=$1`, [affB]))
      .rows[0].tier_level, TIER.TWO);
  });

  test("a repair conversion alone does NOT unlock tier 2", async () => {
    await attribute(db, { orgId: org, affiliateId: affB, clientId: client1 });
    const sale = await mkSale(client1, repairProduct, 1500);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });
    assert.equal(r.converted, true);
    assert.deepEqual(r.tier2Unlocked, [], "only a FUNDED referral unlocks");
    assert.equal((await db.query(`SELECT tier_level FROM affiliates WHERE id=$1`, [affB]))
      .rows[0].tier_level, TIER.ONE);
  });

  test("unlocking is one-way and idempotent", async () => {
    await maybeUnlockTier2(db, { orgId: org, affiliateId: recruiter });
    const at = (await db.query(`SELECT tier2_unlocked_at FROM affiliates WHERE id=$1`,
      [recruiter])).rows[0].tier2_unlocked_at;
    const again = await maybeUnlockTier2(db, { orgId: org, affiliateId: recruiter,
      now: new Date(Date.now() + 60000) });
    assert.equal(again.unlocked, false);
    assert.equal(again.reason, "already_tier2");
    const still = (await db.query(`SELECT tier2_unlocked_at FROM affiliates WHERE id=$1`,
      [recruiter])).rows[0].tier2_unlocked_at;
    assert.equal(still.getTime(), at.getTime(), "the unlock timestamp moved");
  });

  test("an affiliate with nothing qualifying does not unlock", async () => {
    const u = await maybeUnlockTier2(db, { orgId: org, affiliateId: affB });
    assert.equal(u.unlocked, false);
    assert.equal(u.reason, "no_qualifying_event");
  });

  test("a downline override does NOT pay while the recruiter is tier 1", async () => {
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'any','percent',10,'sale_price','first_paid_product')`, [org]);
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1, tier: "direct" });
    await attribute(db, { orgId: org, affiliateId: affB, clientId: client1, tier: "downline" });
    // affB has recruited nobody and has no funded referral → still tier1.
    const sale = await mkSale(client1, repairProduct, 1000);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });

    const downline = r.results.find((x) => x.tier === "downline");
    assert.equal(downline.converted, false);
    assert.equal(downline.reason, "recruiter_not_tier2");
    const row = (await db.query(
      `SELECT commission_due, status FROM affiliate_referrals
        WHERE client_id = $1 AND tier = 'downline'`, [client1])).rows[0];
    assert.equal(row.commission_due, null);
    assert.equal(row.status, "attributed");
  });

  test("a downline override DOES pay once the recruiter is tier 2", async () => {
    await db.query(
      `INSERT INTO affiliate_commission_rules
         (org_id, name, calc_method, percent, amount_basis, scope_rule)
       VALUES ($1,'any','percent',10,'sale_price','first_paid_product')`, [org]);
    await maybeUnlockTier2(db, { orgId: org, affiliateId: recruiter });
    await attribute(db, { orgId: org, affiliateId: affA, clientId: client1, tier: "direct" });
    await attribute(db, { orgId: org, affiliateId: recruiter, clientId: client1, tier: "downline" });
    const sale = await mkSale(client1, repairProduct, 1000);
    const r = await convert(db, { orgId: org, clientId: client1, saleId: sale });

    const downline = r.results.find((x) => x.tier === "downline");
    assert.equal(downline.converted, true);
    assert.equal(Number(downline.commissionDue), 100);
  });

  // ══════════ void ══════════

  test("voiding requires a reason and excludes the referral", async () => {
    const a = await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    await assert.rejects(() => voidReferral(db, { referralId: a.referralId }), /reason is required/);
    const v = await voidReferral(db, { referralId: a.referralId, reason: "fraudulent signup" });
    assert.equal(v.status, "void");
  });

  test("a paid referral cannot be voided out from under a settled payout", async () => {
    const a = await attribute(db, { orgId: org, affiliateId: affA, clientId: client1 });
    await db.query(
      `UPDATE affiliate_referrals SET status='paid', converted_at=now() WHERE id=$1`,
      [a.referralId]);
    assert.equal(await voidReferral(db, { referralId: a.referralId, reason: "too late" }), null);
  });
});
