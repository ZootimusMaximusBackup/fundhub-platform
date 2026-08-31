// api/read/partner-home-tiles.mjs, against real Postgres.
//
// partner-home-tiles.test.mjs proves the composition rules against a stubbed
// tx. This proves the three things only a real database can:
//
//   * the SQL actually runs — real table and view names, real columns
//   * a spend ceiling reporting a real $0 today reads differently from NO
//     ceiling row at all (COALESCE inside the view vs. an absent row) — the
//     exact distinction a hand-written stub cannot check, because a stub
//     cannot get the view's LEFT JOIN LATERAL wrong
//   * one partner's rows never bleed into another's sum
//
// It does not re-prove countFundingClients() — that has its own full pg
// coverage in src/partners/floors.pg.test.mjs (the window edge, a refunded
// deposit, a client who paid twice). Here it only needs to run and return a
// real number; funded_today stays 0 throughout, which is itself the fixture for
// the "zero funded clients -> not known" case end to end.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs file (CLAUDE.md
// §12). Score by exit code — docs/workflows/pg-suite-to-zero-2026-08-27.md.

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { fetchRows } from "../../api/read/partner-home-tiles.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG_A = "hometiles-test-a";
const SLUG_B = "hometiles-test-b";
const MARK = "hometiles-test";

describe("partner home tiles, against real Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerA, partnerB;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    partnerA = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, revenue_share_pct)
       VALUES ($1, 'Hometiles Test A', $2, 'active', 50) RETURNING id`,
      [org, SLUG_A])).rows[0].id;
    partnerB = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, revenue_share_pct)
       VALUES ($1, 'Hometiles Test B', $2, 'active', 50) RETURNING id`,
      [org, SLUG_B])).rows[0].id;
  });

  after(async () => {
    await cleanup();
    await close();
  });

  beforeEach(async () => {
    await deleteRevenue([partnerA, partnerB]);
    // The ad-spend chain too, so a ceiling or a metrics row seeded by one test
    // cannot leak spend into the next — v_partner_spend_vs_ceiling joins on
    // CURRENT_DATE, so a row left behind stays "today" for the whole file.
    await deleteAdSpend([partnerA, partnerB]);
  });

  async function deleteAdSpend(partnerIds) {
    await db.query(`DELETE FROM ad_metrics_daily WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`DELETE FROM ads WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`DELETE FROM ad_sets WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`DELETE FROM campaigns WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`DELETE FROM ad_platform_connections WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`DELETE FROM spend_ceilings WHERE partner_id = ANY($1)`, [partnerIds]);
  }

  /* partner_revenue rows are not deletable in the ordinary run (042: money
     already earned is not disposable, void it instead) — trg_partner_revenue_no_delete
     raises on a bare DELETE. The fixture teardown here is the one place that
     is correct to bypass it, same as src/partners/floors.pg.test.mjs does for
     partner_production_reviews's identical guard. */
  async function deleteRevenue(partnerIds) {
    await db.query(`ALTER TABLE partner_revenue DISABLE TRIGGER trg_partner_revenue_no_delete`);
    await db.query(`DELETE FROM partner_revenue WHERE partner_id = ANY($1)`, [partnerIds]);
    await db.query(`ALTER TABLE partner_revenue ENABLE TRIGGER trg_partner_revenue_no_delete`);
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (!ids.length) return;
    await deleteRevenue(ids);
    await deleteAdSpend(ids);
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }

  /* Full ad-platform chain, mirroring src/http/campaign-endpoints.pg.test.mjs's
     fixture — ad_metrics_daily needs a real ad, which needs a real ad_set,
     campaign and connection; there is no shortcut through the FKs. */
  async function seedAdSpend(partnerId, spendCentsToday) {
    const connId = (await db.query(
      `INSERT INTO ad_platform_connections
         (org_id, partner_id, platform, connection_state, platform_verification_state,
          external_ad_account_id, encrypted_access_token)
       VALUES ($1, $2, 'meta', 'active', 'approved', 'act_${MARK}', $3) RETURNING id`,
      [org, partnerId, `v1:${MARK}:not-a-real-token:placeholder`])).rows[0].id;
    const campaignId = (await db.query(
      `INSERT INTO campaigns
         (org_id, partner_id, connection_id, name, platform, objective, offer_type,
          approval_state, budget_cents)
       VALUES ($1, $2, $3, 'Hometiles Test Campaign', 'meta', 'leads', 'funding',
               'draft', 50000) RETURNING id`,
      [org, partnerId, connId])).rows[0].id;
    const adSetId = (await db.query(
      `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents)
       VALUES ($1, $2, $3, $4, 'Hometiles Test AdSet', 25000) RETURNING id`,
      [org, partnerId, connId, campaignId])).rows[0].id;
    const adId = (await db.query(
      `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name)
       VALUES ($1, $2, $3, $4, $5, 'Hometiles Test Ad') RETURNING id`,
      [org, partnerId, connId, campaignId, adSetId])).rows[0].id;
    await db.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents)
       VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
      [org, partnerId, adId, spendCentsToday]);
  }

  const principalFor = (partnerId) => ({ kind: "partner", partnerId, orgId: org });

  test("cash collected today: sums today's non-void rows, excludes void, excludes yesterday, excludes the OTHER partner", async () => {
    await db.query(
      `INSERT INTO partner_revenue (org_id, partner_id, gross_amount, share_pct_applied, share_amount, status, occurred_at)
       VALUES ($1, $2, 200.00, 50, 100.00, 'accrued', now())`, [org, partnerA]);
    await db.query(
      `INSERT INTO partner_revenue (org_id, partner_id, gross_amount, share_pct_applied, share_amount, status, occurred_at)
       VALUES ($1, $2, 100.00, 50, 50.00, 'paid', now())`, [org, partnerA]);
    await db.query(
      `INSERT INTO partner_revenue
         (org_id, partner_id, gross_amount, share_pct_applied, share_amount, status, void_reason, occurred_at)
       VALUES ($1, $2, 60.00, 50, 30.00, 'void', 'hometiles-test refund', now())`, [org, partnerA]);
    await db.query(
      `INSERT INTO partner_revenue (org_id, partner_id, gross_amount, share_pct_applied, share_amount, status, occurred_at)
       VALUES ($1, $2, 1998.00, 50, 999.00, 'accrued', now() - interval '1 day')`, [org, partnerA]);
    // Another partner's money, dated today. Must never land in A's sum.
    await db.query(
      `INSERT INTO partner_revenue (org_id, partner_id, gross_amount, share_pct_applied, share_amount, status, occurred_at)
       VALUES ($1, $2, 154.00, 50, 77.00, 'accrued', now())`, [org, partnerB]);

    const [row] = await fetchRows(db, { partnerId: partnerA, principal: principalFor(partnerA) });
    // $100 + $50, void and yesterday excluded, partner B's $77 never counted.
    assert.equal(row.cash_collected_today_cents, 15000);
    // The $999 row dated "now() - interval '1 day'" is excluded from TODAY and
    // is exactly what "yesterday" means — the real comparison UI-STANDARDS §7
    // requires, not a placeholder.
    assert.equal(row.cash_collected_yesterday_cents, 99900);
  });

  test("no partner_revenue rows today is a real $0, not unknown", async () => {
    const [row] = await fetchRows(db, { partnerId: partnerA, principal: principalFor(partnerA) });
    assert.equal(row.cash_collected_today_cents, 0);
  });

  test("a partner-scope spend ceiling with real spend today divides correctly against funded_today", async () => {
    await seedAdSpend(partnerA, 4321);
    await db.query(
      `INSERT INTO spend_ceilings (org_id, partner_id, scope, daily_limit_cents)
       VALUES ($1, $2, 'partner', 100000)`, [org, partnerA]);
    const [row] = await fetchRows(db, { partnerId: partnerA, principal: principalFor(partnerA) });
    assert.equal(row.ad_spend_today_cents, 4321);
    // No funding-client fixture was seeded, so funded_today is 0 and the ratio
    // must be "not known" (null) even though spend IS known — never $0, never a
    // divide-by-zero pretending to be an answer.
    assert.equal(row.funded_today, 0);
    assert.equal(row.cost_per_funded_client_cents, null);
  });

  test("a partner-scope ceiling with nothing spent today is a known $0, not null", async () => {
    await db.query(
      `INSERT INTO spend_ceilings (org_id, partner_id, scope, daily_limit_cents)
       VALUES ($1, $2, 'partner', 100000)`, [org, partnerA]);
    const [row] = await fetchRows(db, { partnerId: partnerA, principal: principalFor(partnerA) });
    assert.equal(row.ad_spend_today_cents, 0);
  });

  test("no partner-scope ceiling at all is genuinely unknown, never $0", async () => {
    // Partner B never gets a spend_ceilings row in this file.
    const [row] = await fetchRows(db, { partnerId: partnerB, principal: principalFor(partnerB) });
    assert.equal(row.ad_spend_today_cents, null);
    assert.equal(row.cost_per_funded_client_cents, null);
  });

  test("a partner id that does not resolve under this org returns no rows", async () => {
    const wrongOrg = (await db.query(
      `INSERT INTO orgs (name, slug) VALUES ('Hometiles Test Org', 'hometiles-test-org')
       RETURNING id`)).rows[0].id;
    try {
      const rows = await fetchRows(db, {
        partnerId: partnerA,
        principal: { kind: "partner", partnerId: partnerA, orgId: wrongOrg }
      });
      assert.deepEqual(rows, []);
    } finally {
      await db.query(`DELETE FROM orgs WHERE id = $1`, [wrongOrg]);
    }
  });
});
